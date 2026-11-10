// À COPIER dans votre projet Android Studio (remplace votre MainActivity actuelle).
// 1) Changez "com.votre.package" par le package de votre app (première ligne de votre ancienne MainActivity).
// 2) Changez START_URL par l'adresse de votre serveur Manager PRO.
// 3) Vérifiez que l'id de la WebView dans votre layout est bien "webView" (sinon adaptez).
package com.votre.package

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    companion object {
        const val START_URL = "https://VOTRE-SERVEUR"      // <-- à adapter
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)             // adaptez au nom de votre layout
        webView = findViewById(R.id.webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            // target="_blank" : on intercepte l'ouverture pour l'envoyer à l'application externe
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        // Pont JavaScript : le site l'utilise via window.AndroidBridge (voir native-bridge.js)
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                routeUrl(request.url)
        }

        // Liens target="_blank" (ex. « Ouvrir WhatsApp ») : récupérer l'adresse puis l'envoyer dehors
        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val temp = WebView(view.context)
                temp.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                        openExternal(r.url); v.destroy(); return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = temp
                resultMsg.sendToTarget()
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        if (savedInstanceState == null) webView.loadUrl(START_URL)
    }

    /** true = traité ici (ouvert dans une autre app) ; false = la WebView charge la page normalement. */
    private fun routeUrl(uri: Uri): Boolean {
        val scheme = uri.scheme ?: return false
        val host = uri.host ?: ""
        val appHost = Uri.parse(START_URL).host ?: ""
        val external = when (scheme) {
            "whatsapp", "mailto", "tel", "sms", "geo", "market", "intent" -> true
            "http", "https" -> host != appHost            // wa.me, api.whatsapp.com, autres sites
            else -> false
        }
        if (external) { openExternal(uri); return true }
        return false
    }

    private fun openExternal(uri: Uri) {
        try {
            val u = if (uri.scheme == "intent") Uri.parse(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).dataString) else uri
            startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            toast("Application introuvable (WhatsApp installé ?)")
        } catch (e: Exception) {
            toast("Impossible d'ouvrir ce lien")
        }
    }

    private fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

    inner class Bridge {

        /** Enregistre le fichier (PDF, Excel, CSV…) dans Téléchargements puis l'ouvre dans une application externe. */
        @JavascriptInterface
        fun saveAndOpen(fileName: String, mime: String, base64: String) {
            try {
                val safe = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "fichier" }
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val type = if (mime.isBlank()) "application/octet-stream" else mime.substringBefore(';')

                // Copie dans le dossier cache pour l'ouverture (FileProvider)
                val dir = File(cacheDir, "exports").apply { mkdirs() }
                val file = File(dir, safe).apply { writeBytes(bytes) }

                // Copie durable dans Téléchargements (Android 10+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safe)
                        put(MediaStore.Downloads.MIME_TYPE, type)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)?.let { u ->
                        contentResolver.openOutputStream(u)?.use { it.write(bytes) }
                    }
                }

                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                runOnUiThread {
                    try {
                        startActivity(Intent.createChooser(view, "Ouvrir avec").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: ActivityNotFoundException) {
                        // Aucune appli pour ce type : proposer le partage
                        val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        startActivity(Intent.createChooser(send, "Envoyer le fichier").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }
            } catch (e: Exception) {
                toast("Export impossible : ${e.message}")
            }
        }

        /** Ouvre WhatsApp, l'e-mail, le téléphone… depuis le site. */
        @JavascriptInterface
        fun openExternal(url: String) = runOnUiThread { this@MainActivity.openExternal(Uri.parse(url)) }

        /** HTML généré par le site (export PDF, tickets) : impression via une WebView cachée. */
        @JavascriptInterface
        fun printHtml(html: String) = runOnUiThread {
            val w = WebView(this@MainActivity)
            w.webViewClient = object : WebViewClient() {
                override fun onPageFinished(v: WebView, url: String?) {
                    val pm = getSystemService(PRINT_SERVICE) as PrintManager
                    pm.print("Document", v.createPrintDocumentAdapter("Document"), null)
                }
            }
            w.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
        }

        /** window.print() : fenêtre d'impression / « Enregistrer en PDF » d'Android. */
        @JavascriptInterface
        fun print(title: String) = runOnUiThread {
            val pm = getSystemService(PRINT_SERVICE) as PrintManager
            pm.print(title, webView.createPrintDocumentAdapter(title), null)
        }
    }
}
