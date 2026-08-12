import ExpoModulesCore
import Security

// Typed record — Expo deserialises the JS object into this struct automatically.
struct Argon2Params: Record {
    @Field var password: String = ""
    @Field var salt: String = ""
    @Field var iterations: Int = 3
    @Field var memory: Int = 65536
    @Field var parallelism: Int = 1
    @Field var hashLength: Int = 32
}

public class ExpoCryptoArgon2Module: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoCryptoArgon2")

        Function("randomBytes") { (length: Int) throws -> Data in
            guard (0...1024).contains(length) else {
                throw NSError(domain: "ExpoCryptoArgon2", code: -2, userInfo: [NSLocalizedDescriptionKey: "Random byte length is invalid."])
            }
            var bytes = [UInt8](repeating: 0, count: length)
            let status = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
            guard status == errSecSuccess else {
                throw NSError(domain: "ExpoCryptoArgon2", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Secure random generation failed."])
            }
            return Data(bytes)
        }

        // AsyncFunction with an explicit Promise so we can dispatch to a global
        // concurrent queue — Argon2 is CPU-heavy and must not block the JS thread.
        AsyncFunction("argon2id") { (params: Argon2Params, promise: Promise) in
            DispatchQueue.global(qos: .userInitiated).async {
                // Swift bridges ObjC `NSError **` as a throwing function — use try/catch.
                do {
                    let data = try Argon2Wrapper.argon2id(
                        withPassword: params.password,
                        salt: params.salt,
                        iterations: params.iterations,
                        memory: params.memory,
                        parallelism: params.parallelism,
                        hashLength: params.hashLength
                    )
                    promise.resolve(data)
                } catch {
                    promise.reject(error)
                }
            }
        }
    }
}
