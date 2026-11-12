package com.managepro.app

import android.content.Context

/** Réglages locaux de l'application (privés à l'application). */
object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("managepro", Context.MODE_PRIVATE)

    fun lockEnabled(c: Context) = sp(c).getBoolean("lock", true)
    fun setLock(c: Context, v: Boolean) = sp(c).edit().putBoolean("lock", v).apply()

    fun notifEnabled(c: Context) = sp(c).getBoolean("notif", true)
    fun setNotif(c: Context, v: Boolean) = sp(c).edit().putBoolean("notif", v).apply()

    fun printerMac(c: Context): String? = sp(c).getString("printer_mac", null)
    fun printerName(c: Context): String? = sp(c).getString("printer_name", null)
    fun setPrinter(c: Context, mac: String?, name: String?) = sp(c).edit().putString("printer_mac", mac).putString("printer_name", name).apply()
    fun printerWidth(c: Context) = sp(c).getInt("printer_width", 32)          // 32 = 58 mm, 48 = 80 mm
    fun setPrinterWidth(c: Context, w: Int) = sp(c).edit().putInt("printer_width", w).apply()

    /** Jeton de session transmis par le site, pour les notifications en arrière-plan. */
    fun session(c: Context): Pair<String, String>? {
        val t = sp(c).getString("tk", null)?.takeIf { it.isNotBlank() } ?: return null
        return t to (sp(c).getString("sid", "") ?: "")
    }
    fun setSession(c: Context, tk: String, sid: String) = sp(c).edit().putString("tk", tk).putString("sid", sid).apply()
    fun clearSession(c: Context) = sp(c).edit().remove("tk").remove("sid").remove("seen").apply()

    fun seen(c: Context): Set<String> = sp(c).getStringSet("seen", emptySet()) ?: emptySet()
    fun setSeen(c: Context, s: Set<String>) = sp(c).edit().putStringSet("seen", HashSet(s)).apply()
}
