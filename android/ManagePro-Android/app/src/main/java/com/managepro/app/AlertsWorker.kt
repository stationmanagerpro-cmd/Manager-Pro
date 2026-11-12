package com.managepro.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Toutes les ~15 min : interroge /api/mobile/alerts et notifie chaque nouvelle alerte une seule fois. */
class AlertsWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val c = applicationContext
        if (!Prefs.notifEnabled(c)) return Result.success()
        val (tk, sid) = Prefs.session(c) ?: return Result.success()
        return try {
            val conn = URL(BuildConfig.BASE_URL + "api/mobile/alerts").openConnection() as HttpURLConnection
            conn.connectTimeout = 15000; conn.readTimeout = 25000
            conn.setRequestProperty("Authorization", "Bearer $tk")
            if (sid.isNotBlank()) conn.setRequestProperty("X-Station-Id", sid)
            when (conn.responseCode) {
                200 -> {
                    val arr = JSONObject(conn.inputStream.bufferedReader().readText()).getJSONArray("alerts")
                    val seen = Prefs.seen(c); val current = HashSet<String>(); var shown = 0
                    for (i in 0 until arr.length()) {
                        val a = arr.getJSONObject(i); val key = a.getString("key"); current += key
                        if (key !in seen && shown < 5) { notify(c, key.hashCode(), a.getString("title"), a.optString("body"), a.optString("level") == "critical"); shown++ }
                        else if (key !in seen) current -= key          // pas encore notifiée (limite de 5) : sera reprise au prochain passage
                    }
                    Prefs.setSeen(c, current)
                    Result.success()
                }
                401, 403 -> { Prefs.clearSession(c); Result.success() }   // session expirée : on attend la prochaine connexion
                else -> Result.retry()
            }
        } catch (e: Exception) { Result.retry() }
    }

    private fun notify(c: Context, id: Int, title: String, body: String, critical: Boolean) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val ch = if (critical) "alerts_critical" else "alerts"
        nm.createNotificationChannel(NotificationChannel(ch, if (critical) "Alertes urgentes" else "Alertes Manager PRO", if (critical) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(c, ch).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(open).build()
        NotificationManagerCompat.from(c).notify(id, n)
    }
}
