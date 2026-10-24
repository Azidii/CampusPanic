package com.campuspanic.camera

import java.net.URI

/** Literal private IPv4 only: the application has no public-network destination. */
object LaptopAddress {
    fun parse(input: String): String {
        val text = input.trim()
        val uri = URI(if (text.startsWith("http://")) text else "http://$text")
        require(uri.scheme == "http" && uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "Enter the laptop's local IPv4 address, followed by the port."
        }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "Enter only the laptop address and port." }
        val host = uri.host ?: throw IllegalArgumentException("Enter the laptop's Wi-Fi IPv4 address.")
        val parts = host.split('.')
        require(parts.size == 4 && parts.all { it.isNotEmpty() && it.all(Char::isDigit) && (it.toIntOrNull() ?: -1) in 0..255 }) {
            "Use the laptop Wi-Fi IPv4 address."
        }
        val octets = parts.map { it.toInt() }
        require(octets[0] == 10 || (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168) || (octets[0] == 169 && octets[1] == 254)) {
            "Use the laptop's private Wi-Fi address. Public addresses are disabled."
        }
        val port = if (uri.port == -1) 5055 else uri.port
        require(port in 1..65535) { "The port must be between 1 and 65535." }
        return "http://${octets.joinToString(".")}:$port"
    }
}
