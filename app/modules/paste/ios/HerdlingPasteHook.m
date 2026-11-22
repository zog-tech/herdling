#import "HerdlingPasteHook.h"

#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <stdatomic.h>

/// Longest side of the pasted image, in pixels. A larger image is scaled down.
static const CGFloat kMaxSide = 2048;
/// JPEG quality. The same as PHOTO_QUALITY in JS (the photo picker).
static const CGFloat kQuality = 0.8;

/// Pasted videos older than this are deleted from the temporary folder on the next video paste.
static const NSTimeInterval kVideoMaxAge = 24 * 3600;

static atomic_bool gEnabled = false;
static atomic_bool gVideoEnabled = false;
static _Atomic long long gVideoMaxBytes = 0;
static HerdlingPasteImageHandler gHandler = nil;
static HerdlingPasteVideoHandler gVideoHandler = nil;
static IMP gOrigCanPerform = NULL;
static IMP gOrigPaste = NULL;

static HerdlingPasteImageHandler currentHandler(void)
{
  @synchronized([HerdlingPasteHook class]) {
    return gHandler;
  }
}

static HerdlingPasteVideoHandler currentVideoHandler(void)
{
  @synchronized([HerdlingPasteHook class]) {
    return gVideoHandler;
  }
}

/// True when the pasteboard holds a movie. Reads the type names only: iOS shows no prompt.
static BOOL pasteboardHasMovie(UIPasteboard *pb)
{
  for (NSArray<NSString *> *item in [pb pasteboardTypesForItemSet:nil]) {
    for (NSString *t in item) {
      UTType *type = [UTType typeWithIdentifier:t];
      if (type != nil && [type conformsToType:UTTypeMovie]) return YES;
    }
  }
  return NO;
}

/// True when the video part takes the paste: a video listener is on and the pasteboard has a movie.
static BOOL takesVideo(void)
{
  return atomic_load(&gVideoEnabled) && currentVideoHandler() != nil && pasteboardHasMovie(UIPasteboard.generalPasteboard);
}

/// True when the input shows its edit menu. RCTUITextView has `contextMenuHidden`.
static BOOL menuHidden(id view)
{
  SEL sel = NSSelectorFromString(@"contextMenuHidden");
  if (![view respondsToSelector:sel]) return NO;
  return ((BOOL (*)(id, SEL))objc_msgSend)(view, sel);
}

/// True when the hook takes over the paste: a listener is on, the input is editable,
/// and the pasteboard has an image and no text. Reads the types only: iOS shows no prompt.
static BOOL takesPaste(UITextView *view)
{
  if (!view.isEditable || menuHidden(view)) return NO;
  // A movie wins over its preview image and over a text such as a file name.
  if (takesVideo()) return YES;
  if (!atomic_load(&gEnabled) || currentHandler() == nil) return NO;
  UIPasteboard *pb = UIPasteboard.generalPasteboard;
  return pb.hasImages && !pb.hasStrings;
}

/// `tmp/herdling-paste`, made when missing. Deletes pasted videos older than kVideoMaxAge.
static NSURL *pasteFolder(void)
{
  NSFileManager *fm = NSFileManager.defaultManager;
  NSURL *dir = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"herdling-paste"] isDirectory:YES];
  [fm createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  NSArray<NSURL *> *old = [fm contentsOfDirectoryAtURL:dir includingPropertiesForKeys:@[NSURLContentModificationDateKey] options:0 error:nil];
  for (NSURL *u in old) {
    NSDate *date = nil;
    [u getResourceValue:&date forKey:NSURLContentModificationDateKey error:nil];
    if (date != nil && -date.timeIntervalSinceNow > kVideoMaxAge) [fm removeItemAtURL:u error:nil];
  }
  return dir;
}

/// Loads the first movie of the pasteboard as a file and calls the handler. `loadFileRepresentation`
/// writes the data to a file, so a large video never goes into memory. The file is moved to
/// `pasteFolder()` before the completion handler returns: the system deletes its own copy then.
static void loadVideo(HerdlingPasteVideoHandler handler)
{
  NSItemProvider *provider = nil;
  NSString *typeId = nil;
  for (NSItemProvider *p in UIPasteboard.generalPasteboard.itemProviders) {
    for (NSString *t in p.registeredTypeIdentifiers) {
      UTType *type = [UTType typeWithIdentifier:t];
      if (type != nil && [type conformsToType:UTTypeMovie]) {
        provider = p;
        typeId = t;
        break;
      }
    }
    if (provider != nil) break;
  }
  if (provider == nil) {
    handler(nil, 0, @"video", nil, 0, @"The clipboard has no video.");
    return;
  }
  UTType *type = [UTType typeWithIdentifier:typeId];
  NSString *ext = type.preferredFilenameExtension ?: @"mov";
  NSString *mime = type.preferredMIMEType;
  NSString *base = provider.suggestedName.length > 0 ? [provider.suggestedName stringByDeletingPathExtension] : @"pasted-video";
  NSString *name = [base stringByAppendingPathExtension:ext];
  long long maxBytes = atomic_load(&gVideoMaxBytes);
  [provider loadFileRepresentationForTypeIdentifier:typeId
                                  completionHandler:^(NSURL *_Nullable url, NSError *_Nullable error) {
                                    if (url == nil) {
                                      handler(nil, 0, name, mime, 0, error.localizedDescription ?: @"Could not read the video.");
                                      return;
                                    }
                                    NSFileManager *fm = NSFileManager.defaultManager;
                                    long long size = [[fm attributesOfItemAtPath:url.path error:nil] fileSize];
                                    if (maxBytes > 0 && size > maxBytes) {
                                      handler(nil, size, name, mime, 0, @"too_large");
                                      return;
                                    }
                                    NSURL *dest = [pasteFolder() URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.%@", NSUUID.UUID.UUIDString, ext]];
                                    NSError *moveError = nil;
                                    if (![fm moveItemAtURL:url toURL:dest error:&moveError] &&
                                        ![fm copyItemAtURL:url toURL:dest error:&moveError]) {
                                      handler(nil, size, name, mime, 0, moveError.localizedDescription ?: @"Could not save the video.");
                                      return;
                                    }
                                    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:dest options:nil];
                                    Float64 seconds = CMTimeGetSeconds(asset.duration);
                                    long long ms = isfinite(seconds) && seconds > 0 ? (long long)llround(seconds * 1000) : 0;
                                    handler(dest.absoluteString, size, name, mime, ms, nil);
                                  }];
}

/// Scales `image` to fit kMaxSide, encodes it as JPEG and calls the handler. Runs off the main thread.
static void encodeAndSend(UIImage *image, HerdlingPasteImageHandler handler)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    CGFloat w = image.size.width * image.scale;
    CGFloat h = image.size.height * image.scale;
    if (w <= 0 || h <= 0) return;
    CGFloat k = MIN(1.0, kMaxSide / MAX(w, h));
    CGSize size = CGSizeMake(MAX(1, round(w * k)), MAX(1, round(h * k)));
    UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
    format.scale = 1;
    format.opaque = YES;
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:format];
    // JPEG has no alpha: draw on white so a transparent image does not turn black.
    NSData *data = [renderer JPEGDataWithCompressionQuality:kQuality
                                                    actions:^(UIGraphicsImageRendererContext *ctx) {
                                                      [UIColor.whiteColor setFill];
                                                      [ctx fillRect:CGRectMake(0, 0, size.width, size.height)];
                                                      [image drawInRect:CGRectMake(0, 0, size.width, size.height)];
                                                    }];
    if (data.length == 0) return;
    handler([data base64EncodedStringWithOptions:0], (NSInteger)size.width, (NSInteger)size.height);
  });
}

@implementation HerdlingPasteHook

+ (void)installWithHandler:(HerdlingPasteImageHandler)handler
{
  @synchronized(self) {
    gHandler = [handler copy];
  }
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class cls = NSClassFromString(@"RCTUITextView");
    if (cls == nil) return;
    Method canPerform = class_getInstanceMethod(cls, @selector(canPerformAction:withSender:));
    Method paste = class_getInstanceMethod(cls, @selector(paste:));
    if (canPerform == NULL || paste == NULL) return;

    // Each new IMP calls the old one, so RCTUITextView keeps its own logic
    // (contextMenuHidden, the _textWasPasted flag). The old IMP may come from a superclass:
    // method_setImplementation on a method that RCTUITextView does not define would change
    // UITextView for all text views, so add the method to RCTUITextView first.
    IMP canPerformImp = imp_implementationWithBlock(^BOOL(UITextView *view, SEL action, id sender) {
      BOOL orig = ((BOOL (*)(id, SEL, SEL, id))gOrigCanPerform)(view, @selector(canPerformAction:withSender:), action, sender);
      if (orig) return YES;
      return action == @selector(paste:) && takesPaste(view);
    });
    IMP pasteImp = imp_implementationWithBlock(^(UITextView *view, id sender) {
      HerdlingPasteVideoHandler vh = currentVideoHandler();
      if (vh != nil && view.isEditable && !menuHidden(view) && takesVideo()) {
        // An edit menu paste is a user action: reading the movie shows no "Allow Paste" prompt.
        loadVideo(vh);
        return;
      }
      HerdlingPasteImageHandler h = currentHandler();
      if (h != nil && atomic_load(&gEnabled) && takesPaste(view)) {
        // An edit menu paste is a user action: reading the image shows no "Allow Paste" prompt.
        UIImage *image = UIPasteboard.generalPasteboard.image;
        if (image != nil) {
          encodeAndSend(image, h);
          return;
        }
      }
      ((void (*)(id, SEL, id))gOrigPaste)(view, @selector(paste:), sender);
    });

    gOrigCanPerform = method_getImplementation(canPerform);
    if (!class_addMethod(cls, @selector(canPerformAction:withSender:), canPerformImp, method_getTypeEncoding(canPerform))) {
      method_setImplementation(canPerform, canPerformImp);
    }
    gOrigPaste = method_getImplementation(paste);
    if (!class_addMethod(cls, @selector(paste:), pasteImp, method_getTypeEncoding(paste))) {
      method_setImplementation(paste, pasteImp);
    }
  });
}

+ (void)setEnabled:(BOOL)enabled
{
  atomic_store(&gEnabled, enabled);
}

+ (void)installVideoHandler:(HerdlingPasteVideoHandler)handler
{
  @synchronized(self) {
    gVideoHandler = [handler copy];
  }
}

+ (void)setVideoEnabled:(BOOL)enabled
{
  atomic_store(&gVideoEnabled, enabled);
}

+ (void)setVideoMaxBytes:(long long)maxBytes
{
  atomic_store(&gVideoMaxBytes, maxBytes);
}

@end
