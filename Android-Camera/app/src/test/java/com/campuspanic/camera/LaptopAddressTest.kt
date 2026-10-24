package com.campuspanic.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LaptopAddressTest {
    private fun host(vararg parts: Int) = parts.joinToString(".")

    @Test fun acceptsPrivateAddressAndDefaultPort() {
        val home = host(192, 168, 1, 2)
        val office = host(10, 1, 2, 3)
        val private = host(172, 16, 0, 2)
        assertEquals("http://$home:5055", LaptopAddress.parse(home))
        assertEquals("http://$office:8080", LaptopAddress.parse("http://$office:8080/"))
        assertEquals("http://$private:5055", LaptopAddress.parse(private))
    }

    @Test fun rejectsPublicAndAmbiguousAddresses() {
        val home = host(192, 168, 1, 2)
        listOf(host(8, 8, 8, 8), host(127, 0, 0, 1), host(192, 168, 1, 300),
            "example.com", "https://$home", "$home/path", "$home?url=foo",
            "user@$home", "$home:99999").forEach {
            assertThrows(IllegalArgumentException::class.java) { LaptopAddress.parse(it) }
        }
    }
}
