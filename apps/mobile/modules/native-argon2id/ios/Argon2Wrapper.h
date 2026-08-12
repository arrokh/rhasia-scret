#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Thin ObjC++ wrapper around argon2id_hash_raw.
 * Always returns the raw hash bytes as NSData. Output format conversion happens in JS.
 */
@interface Argon2Wrapper : NSObject

+ (nullable NSData *)argon2idWithPassword:(NSString *)passwordHex
                                     salt:(NSString *)saltHex
                               iterations:(NSInteger)iterations
                                   memory:(NSInteger)memory
                              parallelism:(NSInteger)parallelism
                               hashLength:(NSInteger)hashLength
                                    error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
