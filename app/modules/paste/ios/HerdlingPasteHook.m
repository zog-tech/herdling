#import "HerdlingPasteHook.h"

#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <stdatomic.h>

/// Longest side of the pasted image, in pixels. A larger image is scaled down.
static const CGFloat kMaxSide = 2048;
/// JPEG quality. The same as PHOTO_QUALITY in JS (the photo picker).
static const CGFloat kQuality = 0.8;

static atomic_bool gEnabled = false;
static HerdlingPasteImageHandler gHandler = nil;
static IMP gOrigCanPerform = NULL;
static IMP gOrigPaste = NULL;

static HerdlingPasteImageHandler currentHandler(void)
{
  @synchronized([HerdlingPasteHook class]) {
    return gHandler;
  }
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
  if (!atomic_load(&gEnabled) || currentHandler() == nil) return NO;
  if (!view.isEditable || menuHidden(view)) return NO;
  UIPasteboard *pb = UIPasteboard.generalPasteboard;
  return pb.hasImages && !pb.hasStrings;
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
      HerdlingPasteImageHandler h = currentHandler();
      if (h != nil && takesPaste(view)) {
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

@end
