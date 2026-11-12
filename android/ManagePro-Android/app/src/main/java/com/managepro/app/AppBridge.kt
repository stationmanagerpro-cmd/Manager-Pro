package com.managepro.app

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import org.json.JSONArray
import java.io.File

/**
 * Pont JavaScript exposé au site sous le nom « AndroidBridge ».
 * Contrat d'origine (public/native-bridge.js) : saveAndOpen, openExternal, printHtml, print.
 * Extensions : shareFile, scan, setSession, focusChanged, printTicket.
 */
class AppBridge(private val a: MainActivity) {

    /** Enregistre le fichier dans Téléchargements/ManagePro puis propose de l'ouvrir. */
    @JavascriptInterface
    fun saveAndOpen(fileName: String, mime: String, base64: String) {
        try {
            val safe = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "fichier" }
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val type = if (mime.isBlank()) "application/octet-stream" else mime.substringBefore(';')
            val file = File(File(a.cacheDir, "exports").apply { mkdirs() }, safe).apply { writeBytes(bytes) }
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safe); put(MediaStore.Downloads.MIME_TYPE, type)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + BuildConfig.DOWNLOAD_DIR)
            }
            a.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)?.let { u -> a.contentResolver.openOutputStream(u)?.use { it.write(bytes) } }
            val uri = FileProvider.getUriForFile(a, "${a.packageName}.fileprovider", file)
            val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            a.runOnUiThread {
                try { a.startActivity(Intent.createChooser(view, "Ouvrir avec").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (e: ActivityNotFoundException) { shareUri(uri, type, null) }
            }
        } catch (e: Exception) { a.toast("Export impossible : ${e.message}") }
    }

    /** Feuille de partage Android (WhatsApp, e-mail…) avec le fichier joint. */
    @JavascriptInterface
    fun shareFile(base64: String, mime: String, fileName: String, text: String?) {
        try {
            val safe = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "document" }
            val file = File(File(a.cacheDir, "exports").apply { mkdirs() }, safe).apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)) }
            val uri = FileProvider.getUriForFile(a, "${a.packageName}.fileprovider", file)
            a.runOnUiThread { shareUri(uri, mime.ifBlank { "application/octet-stream" }, text) }
        } catch (e: Exception) { a.toast("Partage impossible : ${e.message}") }
    }

    private fun shareUri(uri: Uri, type: String, text: String?) {
        val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (!text.isNullOrBlank()) send.putExtra(Intent.EXTRA_TEXT, text)
        a.startActivity(Intent.createChooser(send, "Envoyer").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** navigator.share (texte / lien) → feuille de partage Android. */
    @JavascriptInterface
    fun shareText(title: String, text: String, url: String) = a.runOnUiThread {
        val body = listOf(text, url).filter { it.isNotBlank() }.joinToString("\n")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, body)
        if (title.isNotBlank()) send.putExtra(Intent.EXTRA_SUBJECT, title)
        a.startActivity(Intent.createChooser(send, "Partager").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    @JavascriptInterface
    fun openExternal(url: String) = a.runOnUiThread { a.openExternal(Uri.parse(url)) }

    /** HTML généré par le site : ticket sur imprimante Bluetooth si configurée, sinon impression Android. */
    @JavascriptInterface
    fun printHtml(html: String) {
        val isTicket = Regex("(?i)<title>\\s*Ticket").containsMatchIn(html)
        if (isTicket && Prefs.printerMac(a) != null) {
            Thread {
                val err = BtPrinter.print(a, BtPrinter.htmlToLines(html, Prefs.printerWidth(a)))
                if (err == null) a.toast("Ticket imprimé")
                else { a.toast("Imprimante : $err — impression Android"); a.runOnUiThread { systemPrintHtml(html) } }
            }.start()
        } else a.runOnUiThread { systemPrintHtml(html) }
    }

    private fun systemPrintHtml(html: String) {
        val w = WebView(a)
        w.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String?) {
                (a.getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager).print("Document", v.createPrintDocumentAdapter("Document"), null)
            }
        }
        w.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    }

    /** window.print() : fenêtre d'impression / « Enregistrer en PDF » d'Android. */
    @JavascriptInterface
    fun print(title: String) = a.runOnUiThread {
        (a.getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager).print(title, a.web.createPrintDocumentAdapter(title), null)
    }

    /** Ticket en lignes de texte : ["Ligne 1", "Ligne 2"…] → imprimante Bluetooth. */
    @JavascriptInterface
    fun printTicket(linesJson: String) {
        val arr = JSONArray(linesJson); val lines = (0 until arr.length()).map { arr.getString(it) }
        Thread { BtPrinter.print(a, lines)?.let { a.toast("Imprimante : $it") } ?: a.toast("Ticket imprimé") }.start()
    }

    /** Ouvre les réglages natifs (verrouillage, notifications, imprimante) depuis le menu du profil du site. */
    @JavascriptInterface fun openSettings() = a.runOnUiThread { a.showSettings() }
    @JavascriptInterface fun scan() = a.runOnUiThread { a.startScan() }
    @JavascriptInterface fun focusChanged(textFocused: Boolean) = a.runOnUiThread { a.showScanButton(textFocused) }
    @JavascriptInterface fun setSession(token: String, stationId: String) {
        if (token.isBlank()) Prefs.clearSession(a) else Prefs.setSession(a, token, stationId)
    }
    /** Le site indique si un geste vers le bas ne doit PAS déclencher « tirer pour actualiser ». */
    @JavascriptInterface fun refreshBlocked(blocked: Boolean) { a.refreshBlocked = blocked }
    @JavascriptInterface fun isNativeApp(): Boolean = true
}
