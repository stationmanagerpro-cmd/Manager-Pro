package com.managepro.app

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.text.Html
import java.nio.charset.Charset
import java.util.UUID

/** Impression de tickets ESC/POS sur une imprimante thermique Bluetooth déjà jumelée (58 mm ou 80 mm). */
object BtPrinter {
    private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val CP1252: Charset = Charset.forName("windows-1252")

    @SuppressLint("MissingPermission")
    fun bondedDevices(c: Context): List<Pair<String, String>> {
        val a: BluetoothAdapter = (c.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: return emptyList()
        return a.bondedDevices.map { (it.name ?: it.address) to it.address }
    }

    /** HTML d'un ticket → lignes de texte (retire styles, boutons et balises). */
    fun htmlToLines(html: String, width: Int): List<String> {
        val cleaned = html.replace(Regex("(?is)<(style|script|button|title|head)\\b.*?</\\1>"), " ")
            .replace(Regex("(?i)<br\\s*/?>|</(p|div|tr|h[1-6]|li|pre)>"), "\n")
        val text = Html.fromHtml(cleaned, Html.FROM_HTML_MODE_LEGACY).toString().replace(' ', ' ')
        return text.lines().map { it.trimEnd() }.flatMap { wrap(it, width) }.dropWhile { it.isBlank() }
    }

    private fun wrap(s: String, w: Int): List<String> {
        if (s.length <= w) return listOf(s)
        val out = mutableListOf<String>(); var cur = s
        while (cur.length > w) {
            val cut = cur.lastIndexOf(' ', w).takeIf { it > w / 2 } ?: w
            out += cur.substring(0, cut).trimEnd(); cur = cur.substring(cut).trimStart()
        }
        return out + cur
    }

    /** Bloquant : à appeler hors du thread principal. Retourne null si OK, sinon le message d'erreur. */
    @SuppressLint("MissingPermission")
    fun print(c: Context, lines: List<String>): String? {
        val mac = Prefs.printerMac(c) ?: return "Aucune imprimante choisie"
        val adapter = (c.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: return "Bluetooth indisponible"
        if (!adapter.isEnabled) return "Bluetooth désactivé"
        return try {
            adapter.cancelDiscovery()
            val socket = adapter.getRemoteDevice(mac).createRfcommSocketToServiceRecord(SPP)
            socket.use { s ->
                s.connect()
                val o = s.outputStream
                o.write(byteArrayOf(0x1B, 0x40))             // initialisation
                o.write(byteArrayOf(0x1B, 0x74, 16))         // jeu de caractères Windows-1252 (accents)
                for (l in lines) { o.write(l.toByteArray(CP1252)); o.write(0x0A) }
                o.write(byteArrayOf(0x0A, 0x0A, 0x0A))
                o.write(byteArrayOf(0x1D, 0x56, 66, 0))      // coupe (ignorée si l'imprimante n'en a pas)
                o.flush(); Thread.sleep(400)
            }
            null
        } catch (e: Exception) { e.message ?: "Impression Bluetooth impossible" }
    }
}
