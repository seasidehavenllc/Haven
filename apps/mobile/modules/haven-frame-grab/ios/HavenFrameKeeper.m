#import "HavenFrameKeeper.h"

#import <CoreImage/CoreImage.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

@import LiveKitWebRTC;
@import livekit_react_native_webrtc;

static NSString *const kProcessorName = @"haven-frame-grab";
static NSString *const kErrorDomain = @"HavenFrameGrab";

/// Passes every camera frame straight through to the stream, keeping a reference to the newest one.
@interface HavenFrameProcessor : NSObject <LKRNVideoFrameProcessorDelegate>
@property(atomic, strong, nullable) LKRTCVideoFrame *latest;
@property(atomic, assign) CFTimeInterval latestAt;
@end

@implementation HavenFrameProcessor

- (LKRTCVideoFrame *)capturer:(LKRTCVideoCapturer *)capturer didCaptureVideoFrame:(LKRTCVideoFrame *)frame {
  self.latest = frame;
  self.latestAt = CACurrentMediaTime();
  return frame;
}

@end

@implementation HavenFrameKeeper

+ (HavenFrameProcessor *)processor {
  static HavenFrameProcessor *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [HavenFrameProcessor new];
  });
  return shared;
}

+ (void)install {
  [LKRNProcessorProvider addProcessor:[self processor] forName:kProcessorName];
}

+ (NSError *)errorWithCode:(NSInteger)code message:(NSString *)message {
  return [NSError errorWithDomain:kErrorDomain code:code userInfo:@{NSLocalizedDescriptionKey : message}];
}

+ (nullable NSString *)writeLatestJpegWithQuality:(CGFloat)quality
                                          maxSide:(CGFloat)maxSide
                                           maxAge:(NSTimeInterval)maxAge
                                            error:(NSError **)error {
  HavenFrameProcessor *p = [self processor];
  LKRTCVideoFrame *frame = p.latest;
  if (frame == nil || CACurrentMediaTime() - p.latestAt > maxAge) {
    if (error) *error = [self errorWithCode:1 message:@"No recent camera frame"];
    return nil;
  }

  id buffer = frame.buffer;
  if (![buffer isKindOfClass:[LKRTCCVPixelBuffer class]]) {
    if (error) *error = [self errorWithCode:2 message:@"Camera frame isn't in a format that can be saved"];
    return nil;
  }
  CVPixelBufferRef pixels = ((LKRTCCVPixelBuffer *)buffer).pixelBuffer;
  CIImage *image = [CIImage imageWithCVPixelBuffer:pixels];

  // The capturer hands frames over sideways with a rotation to apply; turn the photo upright.
  NSInteger rotation = (NSInteger)frame.rotation;
  CGImagePropertyOrientation orientation = kCGImagePropertyOrientationUp;
  if (rotation == 90) orientation = kCGImagePropertyOrientationRight;
  else if (rotation == 180) orientation = kCGImagePropertyOrientationDown;
  else if (rotation == 270) orientation = kCGImagePropertyOrientationLeft;
  image = [image imageByApplyingCGOrientation:orientation];

  CGFloat longest = MAX(image.extent.size.width, image.extent.size.height);
  if (maxSide > 0 && longest > maxSide) {
    CGFloat scale = maxSide / longest;
    image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
  }

  static CIContext *context;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    context = [CIContext contextWithOptions:nil];
  });
  CGImageRef cg = [context createCGImage:image fromRect:image.extent];
  if (cg == NULL) {
    if (error) *error = [self errorWithCode:3 message:@"Couldn't read the camera frame"];
    return nil;
  }
  NSData *jpeg = UIImageJPEGRepresentation([UIImage imageWithCGImage:cg], quality);
  CGImageRelease(cg);

  NSString *name = [NSString stringWithFormat:@"live-item-%@.jpg", [NSUUID UUID].UUIDString];
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:name];
  if (jpeg == nil || ![jpeg writeToFile:path options:NSDataWritingAtomic error:error]) {
    if (error && *error == nil) *error = [self errorWithCode:4 message:@"Couldn't save the photo"];
    return nil;
  }
  return [NSURL fileURLWithPath:path].absoluteString;
}

@end
