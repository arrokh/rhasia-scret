#import "Argon2Wrapper.h"
#include "argon2.h"
#include <stdlib.h>
#include <string.h>

static NSData *hexToData(NSString *hex) {
    NSUInteger len = hex.length;
    NSMutableData *data = [NSMutableData dataWithLength:len / 2];
    uint8_t *bytes = (uint8_t *)data.mutableBytes;
    for (NSUInteger i = 0; i < len / 2; i++) {
        unsigned int byte = 0;
        [[NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(i * 2, 2)]]
            scanHexInt:&byte];
        bytes[i] = (uint8_t)byte;
    }
    return data;
}

@implementation Argon2Wrapper

+ (nullable NSData *)argon2idWithPassword:(NSString *)passwordHex
                                     salt:(NSString *)saltHex
                               iterations:(NSInteger)iterations
                                   memory:(NSInteger)memory
                              parallelism:(NSInteger)parallelism
                               hashLength:(NSInteger)hashLength
                                    error:(NSError *_Nullable *_Nullable)error {
    NSData *pwdData  = hexToData(passwordHex);
    NSData *saltData = hexToData(saltHex);

    uint8_t *hash = (uint8_t *)malloc((size_t)hashLength);
    if (!hash) {
        if (error) {
            *error = [NSError errorWithDomain:@"ExpoCryptoArgon2" code:-1
                userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate hash buffer"}];
        }
        return nil;
    }

    int rc = argon2id_hash_raw(
        (uint32_t)iterations,
        (uint32_t)memory,
        (uint32_t)parallelism,
        pwdData.bytes,  pwdData.length,
        saltData.bytes, saltData.length,
        hash, (size_t)hashLength
    );

    if (rc != ARGON2_OK) {
        memset(hash, 0, (size_t)hashLength);
        free(hash);
        if (error) {
            *error = [NSError errorWithDomain:@"ExpoCryptoArgon2" code:rc
                userInfo:@{NSLocalizedDescriptionKey:
                    [NSString stringWithUTF8String:argon2_error_message(rc)]}];
        }
        return nil;
    }

    NSData *result = [NSData dataWithBytes:hash length:(NSUInteger)hashLength];
    memset(hash, 0, (size_t)hashLength);
    free(hash);
    return result;
}

@end
