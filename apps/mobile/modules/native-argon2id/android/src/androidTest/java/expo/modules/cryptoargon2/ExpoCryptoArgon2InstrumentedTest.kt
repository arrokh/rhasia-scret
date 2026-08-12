package expo.modules.cryptoargon2

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ExpoCryptoArgon2InstrumentedTest {
    @Test
    fun derivesSharedArgon2idProtocolVectorThroughJni() {
        val module = ExpoCryptoArgon2Module()
        val method = ExpoCryptoArgon2Module::class.java.declaredMethods.single { it.name == "nativeArgon2id" }
        method.isAccessible = true
        val actual = method.invoke(
            module,
            "706c6174666f726d20706f72746162696c69747920766563746f72",
            "000102030405060708090a0b0c0d0e0f",
            3,
            64 * 1024,
            1,
            32,
        ) as ByteArray

        assertArrayEquals(hex("6562731dde64f1563378dc4609d8eaba0361a655ff24e2739dd89ae592a077c5"), actual)
        actual.fill(0)
    }

    @Test
    fun platformSecureRandomProducesIndependentBytes() {
        val random = java.security.SecureRandom()
        val first = ByteArray(32).also(random::nextBytes)
        val second = ByteArray(32).also(random::nextBytes)
        assertEquals(32, first.size)
        assertFalse(first.all { it == 0.toByte() })
        assertFalse(first.contentEquals(second))
        first.fill(0)
        second.fill(0)
    }

    private fun hex(value: String): ByteArray = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
