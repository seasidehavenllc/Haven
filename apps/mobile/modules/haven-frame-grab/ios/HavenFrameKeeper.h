#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

NS_ASSUME_NONNULL_BEGIN

/// Remembers the most recent frame from the host's camera (registered with react-native-webrtc as the
/// video effect "haven-frame-grab", which passes every frame through untouched) and saves it as a JPEG.
@interface HavenFrameKeeper : NSObject

/// Registers the frame processor. Safe to call more than once.
+ (void)install NS_SWIFT_NAME(install());

/// Writes the latest frame (if it is newer than `maxAge` seconds) to a JPEG in the temp folder and
/// returns its file URL, upright and at most `maxSide` pixels on its longer side.
+ (nullable NSString *)writeLatestJpegWithQuality:(CGFloat)quality
                                          maxSide:(CGFloat)maxSide
                                           maxAge:(NSTimeInterval)maxAge
                                            error:(NSError **)error NS_SWIFT_NAME(writeLatestJpeg(quality:maxSide:maxAge:));

@end

NS_ASSUME_NONNULL_END
