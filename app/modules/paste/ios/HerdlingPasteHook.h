#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Gets the pasted image as base64 JPEG, with its size in pixels. Runs on a background queue.
typedef void (^HerdlingPasteImageHandler)(NSString *base64, NSInteger width, NSInteger height);

/// Gets a pasted video as a file. On success `uri` is a file URL in the temporary folder, `size` is in
/// bytes and `durationMs` is the length (0 when unknown). On failure `uri` is nil and `error` is
/// "too_large" (then `size` is set) or a message. Runs on a background queue.
typedef void (^HerdlingPasteVideoHandler)(NSString *_Nullable uri, long long size, NSString *name,
                                          NSString *_Nullable mime, long long durationMs, NSString *_Nullable error);

/// Lets a multiline React Native text input (RCTUITextView) paste an image or a video.
/// The edit menu shows "Paste" when the pasteboard holds an image (or a video, while the video hook
/// is on), and the image or the video goes to its handler.
@interface HerdlingPasteHook : NSObject

/// Swizzles RCTUITextView one time. A second call only replaces the handler.
+ (void)installWithHandler:(HerdlingPasteImageHandler)handler;

/// Sets the handler of pasted videos. The swizzle comes from `installWithHandler:`.
+ (void)installVideoHandler:(HerdlingPasteVideoHandler)handler;

/// The hook acts only while this is YES (a JS listener is on). Otherwise the input works as before.
+ (void)setEnabled:(BOOL)enabled;

/// The video part acts only while this is YES (a JS video listener is on).
+ (void)setVideoEnabled:(BOOL)enabled;

/// A video larger than this is not copied: the handler gets "too_large". 0 means no limit.
+ (void)setVideoMaxBytes:(long long)maxBytes;

@end

NS_ASSUME_NONNULL_END
