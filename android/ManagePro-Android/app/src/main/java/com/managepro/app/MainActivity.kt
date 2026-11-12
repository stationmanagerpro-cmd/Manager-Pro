package com.managepro.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.*
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.snackbar.Snackbar
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.managepro.app.databinding.ActivityMainBinding
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var ui: ActivityMainBinding
    val web: WebView get() = ui.web
    private val handler = Handler(Looper.getMainLooper())
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null
    private var lastBackPress = 0L
    private var failed = false
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var backgroundedAt = 0L
    private var locked = false
    @Volatile var refreshBlocked = false          // renseigné par le site au toucher (voir INJECT_JS)
    private val host: String = BuildConfig.SITE_HOST

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)); fileCallback = null
    }
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pendingPermissionRequest?.let { if (ok) it.grant(it.resources) else it.deny() }; pendingPermissionRequest = null
    }
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private val locPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        pendingGeo?.let { (o, cb) -> cb.invoke(o, r.values.any { it }, false) }; pendingGeo = null
    }
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private var afterBtPermission: (() -> Unit)? = null
    private val btPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) afterBtPermission?.invoke() else toast("Autorisation Bluetooth refusée")
        afterBtPermission = null
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        ui = ActivityMainBinding.inflate(layoutInflater)
        setContentView(ui.root)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(ui.root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom)); WindowInsetsCompat.CONSUMED
        }
        WindowCompat.getInsetsController(window, ui.root).apply { isAppearanceLightNavigationBars = true; isAppearanceLightStatusBars = true }

        with(ui.web.settings) {
            javaScriptEnabled = true; domStorageEnabled = true; databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true; loadWithOverviewMode = false
            setSupportZoom(true); builtInZoomControls = true; displayZoomControls = false
            textZoom = 100
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)      // target="_blank" (WhatsApp…) intercepté dans onCreateWindow
            userAgentString = "$userAgentString ${BuildConfig.UA_TAG}/${BuildConfig.VERSION_NAME}"
        }
        ui.web.setBackgroundColor(ContextCompat.getColor(this, R.color.surface))
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(ui.web, false) }
        ui.web.addJavascriptInterface(AppBridge(this), "AndroidBridge")     // contrat de public/native-bridge.js

        ui.web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(v: WebView, url: String, favicon: Bitmap?) {
                failed = false; ui.progress.visibility = View.VISIBLE
                handler.removeCallbacks(wakingHint); handler.postDelayed(wakingHint, 8000)
            }
            override fun onPageFinished(v: WebView, url: String) {
                handler.removeCallbacks(wakingHint); ui.waking.visibility = View.GONE
                ui.progress.visibility = View.GONE; ui.swipe.isRefreshing = false
                if (!failed) { ui.offline.visibility = View.GONE; v.evaluateJavascript("window.__mpSync=${BuildConfig.SESSION_SYNC};window.__mpPoly=${BuildConfig.POLYFILLS};$INJECT_JS", null) }
                CookieManager.getInstance().flush()
            }
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.scheme == "https" && u.host == host) return false
                openExternal(u); return true
            }
            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) { failed = true; ui.offline.visibility = View.VISIBLE }
            }
            override fun onReceivedHttpError(v: WebView, req: WebResourceRequest, resp: WebResourceResponse) {
                if (req.isForMainFrame && resp.statusCode >= 500) { failed = true; ui.offline.visibility = View.VISIBLE }
            }
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean { v.reload(); return true }
        }
        ui.web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(v: WebView, p: Int) { ui.progress.setProgressCompat(p, true) }
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                return try { filePicker.launch(p.createIntent()); true } catch (e: ActivityNotFoundException) { fileCallback = null; false }
            }
            // Géolocalisation (« près de moi », carte) : uniquement pour le site de l'application
            override fun onGeolocationPermissionsShowPrompt(origin: String, cb: GeolocationPermissions.Callback) {
                val ok = Uri.parse(origin).host == host
                val granted = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                when {
                    !ok -> cb.invoke(origin, false, false)
                    granted -> cb.invoke(origin, true, false)
                    else -> { pendingGeo = origin to cb; locPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
                }
            }
            override fun onPermissionRequest(req: PermissionRequest) {
                if (req.origin.host == host && req.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    pendingPermissionRequest = req; cameraPermission.launch(Manifest.permission.CAMERA)
                } else req.deny()
            }
            // target="_blank" : l'adresse est envoyée à l'application externe (WhatsApp, e-mail…)
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val temp = WebView(view.context)
                temp.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                        // même site (ex. fichier ouvert dans un nouvel onglet) : dans l'application, avec la session ; sinon application externe
                        if (r.url.scheme == "https" && r.url.host == host) view.loadUrl(r.url.toString()) else openExternal(r.url)
                        v.destroy(); return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = temp; resultMsg.sendToTarget(); return true
            }
        }
        ui.web.setDownloadListener { url, ua, disposition, mime, _ -> download(url, ua, disposition, mime) }

        ui.swipe.setColorSchemeResources(R.color.brand)
        ui.swipe.setOnRefreshListener {
            // garde-fou : si des données saisies ne sont pas enregistrées, demander avant de recharger la page
            ui.web.evaluateJavascript(DIRTY_JS) { r ->
                if (r == "true") {
                    ui.swipe.isRefreshing = false
                    MaterialAlertDialogBuilder(this).setTitle("Actualiser la page ?").setMessage("Les données saisies et non enregistrées seront perdues.")
                        .setPositiveButton("Actualiser") { _, _ -> ui.web.reload() }.setNegativeButton("Annuler", null).show()
                } else ui.web.reload()
            }
        }
        ui.swipe.setOnChildScrollUpCallback { _, _ -> ui.web.scrollY > 0 || refreshBlocked }
        ui.retry.setOnClickListener { ui.offline.visibility = View.GONE; failed = false; ui.web.loadUrl(BuildConfig.BASE_URL) }
        ui.scan.setOnClickListener { startScan() }
        ui.unlock.setOnClickListener { promptUnlock() }
        ui.quit.setOnClickListener { finishAffinity() }

        netCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: Network) { if (failed) runOnUiThread { ui.retry.performClick() } }
        }
        (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).registerDefaultNetworkCallback(netCallback!!)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (locked) { finishAffinity(); return }
                ui.web.evaluateJavascript("(function(){var m=document.getElementById('m');if(m&&m.style.display&&m.style.display!=='none'&&m.innerHTML){if(typeof closeM==='function'){closeM();return 'm'}}return ''})()") { r ->
                    if (r?.contains("m") == true) return@evaluateJavascript
                    if (ui.web.canGoBack()) ui.web.goBack()
                    else {
                        val now = System.currentTimeMillis()
                        if (now - lastBackPress < 2000) finish() else { lastBackPress = now; toast(getString(R.string.press_again)) }
                    }
                }
            }
        })

        val start = intent?.data?.takeIf { it.host == host }?.toString() ?: BuildConfig.BASE_URL
        if (savedInstanceState == null) ui.web.loadUrl(start) else ui.web.restoreState(savedInstanceState)

        if (BuildConfig.ALERTS) scheduleAlerts()
        if (intent?.action == ACTION_SETTINGS) ui.web.post { showSettings() }
        if (BuildConfig.ALERTS && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        lockIfNeeded()
    }

    private val wakingHint = Runnable { ui.waking.visibility = View.VISIBLE }

    // ---------- Verrouillage empreinte / code ----------
    private fun lockIfNeeded() {
        if (!Prefs.lockEnabled(this) || locked) return
        val can = BiometricManager.from(this).canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
        if (can != BiometricManager.BIOMETRIC_SUCCESS) return      // aucun verrouillage d'écran sur le téléphone : rien à demander
        locked = true; ui.lock.visibility = View.VISIBLE; promptUnlock()
    }
    private fun promptUnlock() {
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(getString(R.string.app_name)).setSubtitle("Déverrouillez pour continuer")
            .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL).build()
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { locked = false; ui.lock.visibility = View.GONE }
        }).authenticate(info)
    }
    override fun onStop() { backgroundedAt = System.currentTimeMillis(); super.onStop() }
    override fun onStart() {
        super.onStart()
        if (backgroundedAt > 0 && System.currentTimeMillis() - backgroundedAt > 60_000) lockIfNeeded()   // reverrouillage après 1 min en arrière-plan
    }

    // ---------- Scan code-barres ----------
    fun showScanButton(show: Boolean) { ui.scan.visibility = if (show) View.VISIBLE else View.GONE }
    fun startScan() {
        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).enableAutoZoom().build()
        GmsBarcodeScanning.getClient(this, opts).startScan()
            .addOnSuccessListener { b -> b.rawValue?.let { ui.web.evaluateJavascript("window.__mpScan&&window.__mpScan(${JSONObject.quote(it)})", null) } }
            .addOnFailureListener { toast("Scan impossible : ${it.message ?: "annulé"}") }
    }

    // ---------- Notifications ----------
    private fun scheduleAlerts() {
        val req = PeriodicWorkRequestBuilder<AlertsWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("managepro-alerts", ExistingPeriodicWorkPolicy.UPDATE, req)
    }

    // ---------- Réglages natifs ----------
    fun showSettings() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 24, 48, 0) }
        fun sw(label: String, on: Boolean, change: (Boolean) -> Unit) = MaterialSwitch(this).apply { text = label; isChecked = on; setOnCheckedChangeListener { _, v -> change(v) }; col.addView(this) }
        sw("Verrouillage empreinte / code", Prefs.lockEnabled(this)) { Prefs.setLock(this, it) }
        if (BuildConfig.ALERTS) sw("Notifications (stock, factures, fiscal, quart)", Prefs.notifEnabled(this)) { Prefs.setNotif(this, it) }
        if (!BuildConfig.BT_PRINT) { MaterialAlertDialogBuilder(this).setTitle(R.string.settings).setView(col).setPositiveButton("Fermer", null).show(); return }
        val printer = com.google.android.material.button.MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "Imprimante Bluetooth : ${Prefs.printerName(this@MainActivity) ?: "aucune"}"; setOnClickListener { choosePrinter() }
        }
        col.addView(printer)
        val width = com.google.android.material.button.MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "Largeur du ticket : ${if (Prefs.printerWidth(this@MainActivity) >= 48) "80 mm" else "58 mm"}"
            setOnClickListener { Prefs.setPrinterWidth(this@MainActivity, if (Prefs.printerWidth(this@MainActivity) >= 48) 32 else 48); text = "Largeur du ticket : ${if (Prefs.printerWidth(this@MainActivity) >= 48) "80 mm" else "58 mm"}" }
        }
        col.addView(width)
        val test = com.google.android.material.button.MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "Imprimer un ticket test"
            setOnClickListener { withBluetooth { Thread { BtPrinter.print(this@MainActivity, listOf(getString(R.string.app_name), "Test d'impression", "Caractères : é è à ç ô", "")) ?.let { toast("Imprimante : $it") } ?: toast("Ticket imprimé") }.start() } }
        }
        col.addView(test)
        MaterialAlertDialogBuilder(this).setTitle(R.string.settings).setView(col).setPositiveButton("Fermer", null).show()
    }
    private fun withBluetooth(then: () -> Unit) {
        if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            afterBtPermission = then; btPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
        } else then()
    }
    private fun choosePrinter() = withBluetooth {
        val devices = BtPrinter.bondedDevices(this)
        if (devices.isEmpty()) { toast("Aucun appareil jumelé : jumelez d'abord l'imprimante dans les réglages Bluetooth d'Android."); return@withBluetooth }
        AlertDialog.Builder(this).setTitle("Choisir l'imprimante")
            .setItems(devices.map { "${it.first}  (${it.second})" }.toTypedArray()) { _, i -> Prefs.setPrinter(this, devices[i].second, devices[i].first); toast("Imprimante : ${devices[i].first}") }
            .setNeutralButton("Aucune") { _, _ -> Prefs.setPrinter(this, null, null) }.show()
    }

    // ---------- Divers ----------
    fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }
    fun openExternal(uri: Uri) {
        try {
            val u = if (uri.scheme == "intent") Uri.parse(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).dataString) else uri
            startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) { toast("Application introuvable (WhatsApp installé ?)") }
        catch (e: Exception) { toast("Impossible d'ouvrir ce lien") }
    }
    private fun download(url: String, ua: String?, disposition: String?, mime: String?) {
        if (url.startsWith("blob:") || !url.startsWith("https")) return   // les blob: sont gérés par native-bridge.js (AndroidBridge.saveAndOpen)
        val name = URLUtil.guessFileName(url, disposition, mime)
        val req = DownloadManager.Request(Uri.parse(url)).apply {
            setMimeType(mime); addRequestHeader("User-Agent", ua)
            CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "${BuildConfig.DOWNLOAD_DIR}/$name")
        }
        (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
        Snackbar.make(ui.root, R.string.file_saved, Snackbar.LENGTH_SHORT).show()
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); if (intent.action == ACTION_SETTINGS) ui.web.post { showSettings() }; intent.data?.takeIf { it.host == host }?.let { ui.web.loadUrl(it.toString()) } }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); ui.web.saveState(outState) }
    override fun onPause() { ui.web.onPause(); CookieManager.getInstance().flush(); super.onPause() }
    override fun onResume() { super.onResume(); ui.web.onResume() }
    override fun onDestroy() {
        netCallback?.let { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) }
        ui.web.apply { stopLoading(); destroy() }; super.onDestroy()
    }

    companion object {
        const val ACTION_SETTINGS = "com.managepro.app.OPEN_SETTINGS"
        /** Vrai si un champ de saisie a été modifié depuis le chargement (données non enregistrées). */
        private const val DIRTY_JS = """
        (function(){var n=document.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select');
          for(var i=0;i<n.length;i++){var e=n[i];
            if(e.tagName==='SELECT'){for(var j=0;j<e.options.length;j++){if(e.options[j].selected!==e.options[j].defaultSelected)return true}}
            else if(e.type==='checkbox'||e.type==='radio'){if(e.checked!==e.defaultChecked)return true}
            else if(e.value!==e.defaultValue)return true}
          return false})()"""
        /** Injecté après chaque chargement : zoom/tableaux, session pour les notifications, scan, focus des champs.
         *  Les exports/impressions/WhatsApp sont gérés par native-bridge.js du site (via AndroidBridge). */
        private const val INJECT_JS = """
        (function(){
          if(window.__mpInjected)return;window.__mpInjected=true;
          var m=document.querySelector('meta[name=viewport]');
          if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m)}
          m.content='width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover';
          var s=document.createElement('style');
          s.textContent='html{-webkit-text-size-adjust:100%;overscroll-behavior-y:contain}*{-webkit-tap-highlight-color:transparent}img,svg,canvas,video{max-width:100%}.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}body{overflow-x:hidden}';
          document.head.appendChild(s);
          /* anti-actualisation accidentelle : pas de « tirer pour actualiser » dans un formulaire, un champ actif ou une zone déjà défilée */
          document.addEventListener('touchstart',function(e){var b=false;try{
            var m=document.getElementById('m');if(m&&m.innerHTML&&getComputedStyle(m).display!=='none')b=true;
            var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)${'$'}/.test(a.tagName))b=true;
            for(var el=e.target;el&&el!==document.body&&!b;el=el.parentElement){if(el.scrollTop>0)b=true}
          }catch(x){}try{AndroidBridge.refreshBlocked(b)}catch(x){}},{capture:true,passive:true});
          if(window.__mpSync){
            var sync=function(){try{AndroidBridge.setSession(localStorage.getItem('smp-tk')||'',localStorage.getItem('smp-sid')||'')}catch(e){}};
            sync();setInterval(sync,15000);window.addEventListener('storage',sync);
          }
          if(window.__mpPoly){   /* sites sans native-bridge.js : fonctions que la WebView n'offre pas */
            window.print=function(){try{AndroidBridge.print(document.title||'Document')}catch(e){}};
            if(!navigator.share)navigator.share=function(d){try{AndroidBridge.shareText((d&&d.title)||'',(d&&d.text)||'',(d&&d.url)||'');return Promise.resolve()}catch(e){return Promise.reject(e)}};
            var wo=window.open;
            window.open=function(u,n,f){
              if(typeof u==='string'&&u.indexOf('blob:')===0){
                fetch(u).then(function(r){return r.blob()}).then(function(b){var fr=new FileReader();fr.onload=function(){
                  var s=String(fr.result),i=s.indexOf(',');var ext=(b.type.split('/')[1]||'bin').split(';')[0].replace('jpeg','jpg');
                  AndroidBridge.saveAndOpen('document.'+ext,b.type||'application/octet-stream',s.slice(i+1));};fr.readAsDataURL(b)});
                return null;
              }
              return wo.call(window,u,n,f);
            };
          }
          /* pas de bouton Scanner sur la connexion (ni dans un formulaire à mot de passe) : il masquait les champs de saisie */
          function isLogin(t){try{return t.id==='lu'||(t.form&&t.form.querySelector('input[type=password]'))||!!t.closest('.login,#login,#lg')}catch(x){return false}}
          function isText(t){return t&&/^(INPUT|TEXTAREA)${'$'}/.test(t.tagName)&&!/^(checkbox|radio|file|date|month|time|button|submit|hidden|password|range|color)${'$'}/.test(t.type||'')&&!isLogin(t)}
          document.addEventListener('focusin',function(e){if(isText(e.target)){window.__mpLast=e.target;try{AndroidBridge.focusChanged(true)}catch(x){}}},true);
          document.addEventListener('focusout',function(){setTimeout(function(){if(!isText(document.activeElement)){try{AndroidBridge.focusChanged(false)}catch(x){}}},250)},true);
          window.__mpScan=function(code){
            if(typeof window.__mpScanHandler==='function'&&window.__mpScanHandler(code)!==false)return;
            var t=window.__mpLast;if(!t||!document.contains(t))t=document.querySelector('input[type=search],#pg input[type=text]');
            if(!t)return;
            var d=Object.getOwnPropertyDescriptor(t.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');
            d.set.call(t,code);t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new Event('change',{bubbles:true}));
            t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));t.focus();
          };
        })();"""
    }
}
