#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include <cstdint>
#include "argon2.h"

static std::vector<uint8_t> hexDecode(const char *hex, size_t hexLen) {
    std::vector<uint8_t> out(hexLen / 2);
    for (size_t i = 0; i < out.size(); ++i) {
        char hi = hex[i * 2];
        char lo = hex[i * 2 + 1];
        uint8_t h = (hi >= 'a') ? (uint8_t)(hi - 'a' + 10) : (uint8_t)(hi - '0');
        uint8_t l = (lo >= 'a') ? (uint8_t)(lo - 'a' + 10) : (uint8_t)(lo - '0');
        out[i] = (h << 4) | l;
    }
    return out;
}

// JNI function name: Java_<package>_<class>_<method>
extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_cryptoargon2_ExpoCryptoArgon2Module_nativeArgon2id(
    JNIEnv *env,
    jobject /* thiz */,
    jstring inputHex,
    jstring saltHex,
    jint    iterations,
    jint    memory,
    jint    parallelism,
    jint    hashLength
) {
    const char *inputHexC = env->GetStringUTFChars(inputHex, nullptr);
    const char *saltHexC = env->GetStringUTFChars(saltHex,     nullptr);

    auto input = hexDecode(inputHexC, (size_t)env->GetStringUTFLength(inputHex));
    auto salt = hexDecode(saltHexC, (size_t)env->GetStringUTFLength(saltHex));

    env->ReleaseStringUTFChars(inputHex, inputHexC);
    env->ReleaseStringUTFChars(saltHex,     saltHexC);

    std::vector<uint8_t> hash((size_t)hashLength);

    int rc = argon2id_hash_raw(
        (uint32_t)iterations, (uint32_t)memory, (uint32_t)parallelism,
        input.data(), input.size(),
        salt.data(), salt.size(),
        hash.data(), hash.size()
    );

    std::memset(pwd.data(), 0, pwd.size());

    if (rc != ARGON2_OK) {
        std::memset(hash.data(), 0, hash.size());
        jclass ex = env->FindClass("java/lang/Exception");
        env->ThrowNew(ex, argon2_error_message(rc));
        return nullptr;
    }

    jbyteArray result = env->NewByteArray((jsize)hash.size());
    env->SetByteArrayRegion(result, 0, (jsize)hash.size(),
                            reinterpret_cast<const jbyte *>(hash.data()));
    std::memset(hash.data(), 0, hash.size());
    return result;
}
