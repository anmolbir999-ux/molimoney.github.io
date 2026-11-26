package com.molimoney.app.system

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
import com.molimoney.app.MainActivity
import com.molimoney.app.R
import com.molimoney.app.data.Tx
import com.molimoney.app.logic.Daily
import com.molimoney.app.logic.money

object Notifier {
    private const val CH_WRAP = "wrapped"
    private const val CH_TRACK = "tracked"
    private const val ID_WRAP = 1001

    fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_WRAP, "Daily wrap-up", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Moli Wrapped: your day's spending, every evening"
        })
        nm.createNotificationChannel(NotificationChannel(CH_TRACK, "Auto-logged payments", NotificationManager.IMPORTANCE_LOW).apply {
            description = "A quiet note whenever Moli logs a payment for you"
        })
    }

    fun canPost(ctx: Context) = Build.VERSION.SDK_INT < 33 ||
        ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun open(ctx: Context, what: String, req: Int): PendingIntent =
        PendingIntent.getActivity(
            ctx, req,
            Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN, what)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun wrapped(ctx: Context) {
        if (!canPost(ctx)) return
        channels(ctx)
        val store = Repo.get(ctx)
        val cur = store.settings.currency
        val fmt: (Double) -> String = { money(it, cur) }
        val d = Daily.summarize(store.txs.toList(), store.settings, fmt)
        val title = if (d.count == 0) "Your day, wrapped: a no-spend day ✨" else "Your day, wrapped: ${fmt(d.spent)} spent"
        val line = if (d.count == 0) d.advice
        else "${d.count} purchase${if (d.count == 1) "" else "s"}${d.top?.let { ", mostly ${it.first.label.lowercase()}" } ?: ""}. ${d.advice}"
        val n = NotificationCompat.Builder(ctx, CH_WRAP)
            .setSmallIcon(R.drawable.ic_stat_moli)
            .setColor(0xFFD9775A.toInt())
            .setContentTitle(title)
            .setContentText(line)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$line\n\nTap to see your recap."))
            .setContentIntent(open(ctx, MainActivity.OPEN_WRAPPED, 1))
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(ID_WRAP, n) }
    }

    fun tracked(ctx: Context, tx: Tx, currency: String) {
        if (!canPost(ctx)) return
        channels(ctx)
        val amt = money(tx.amount, currency, decimals = true)
        val n = NotificationCompat.Builder(ctx, CH_TRACK)
            .setSmallIcon(R.drawable.ic_stat_moli)
            .setColor(0xFFD9775A.toInt())
            .setContentTitle(if (tx.isIncome) "Logged +$amt" else "Logged $amt" + (tx.note.takeIf { it.isNotBlank() }?.let { " at $it" } ?: ""))
            .setContentText("Filed under ${tx.category.label}. Tap to review.")
            .setContentIntent(open(ctx, MainActivity.OPEN_ACTIVITY, 2))
            .setAutoCancel(true)
            .setSilent(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify((tx.id % Int.MAX_VALUE).toInt(), n) }
    }
}
