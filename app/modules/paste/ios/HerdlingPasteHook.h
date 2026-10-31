#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Gets the pasted image as base64 JPEG, with its size in pixels. Runs on a background queue.
typedef void (^HerdlingPasteImageHandler)(NSString *base64, NSInteger width, NSInteger height);

/// Lets a multiline React Native text input (RCTUITextView) paste an image.
/// The edit menu shows "Paste" when the pasteboard holds an image, and the image goes to the handler.
@interface HerdlingPasteHook : NSObject

/// Swizzles RCTUITextView one time. A second call only replaces the handler.
+ (void)installWithHandler:(HerdlingPasteImageHandler)handler;

/// The hook acts only while this is YES (a JS listener is on). Otherwise the input works as before.
+ (void)setEnabled:(BOOL)enabled;

@end

NS_ASSUME_NONNULL_END
