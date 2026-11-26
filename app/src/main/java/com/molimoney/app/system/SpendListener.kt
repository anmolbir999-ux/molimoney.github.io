package com.molimoney.app.system

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import com.molimoney.app.data.Category
import com.molimoney.app.data.Tx
import com.molimoney.app.logic.Categorizer
import com.molimoney.app.logic.NotifParser
import java.time.LocalDate

/**
 * Reads payment alerts (bank, card, UPI, wallet apps) as they arrive and logs them.
 * Nothing is stored except the resulting transaction; nothing leaves the phone.
 */
class SpendListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        runCatching { handle(sbn) }
    }

    private fun handle(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || sbn.isOngoing) return
        val pkg = sbn.packageName.lowercase()
        if (chatApps.any { pkg.contains(it) }) return
        val store = Repo.get(this)
        if (!store.settings.autoTrack) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (text.isBlank()) return
        val p = NotifParser.parse(title, text) ?: return

        val today = LocalDate.now()
        val sig = "${today}|${Math.round(p.amount * 100)}|${text.trim().hashCode()}"
        if (!store.markSeen(sig)) return

        val appName = runCatching {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
        }.getOrDefault("")
        val note = p.merchant.ifBlank { appName }
        val cat: Category = Categorizer.guess("${p.merchant} $text", p.income)
        val tx = Tx(store.newId(), p.amount, cat, note, today.toEpochDay(), source = "a")
        store.upsert(tx)
        Notifier.tracked(this, tx, store.settings.currency)
    }

    companion object {
        private val chatApps = listOf("whatsapp", "telegram", "signal", "messenger", "instagram", "discord", "slack",
            "snapchat", "wechat", "jp.naver.line", "viber", "skype", "teams", "gmail", "email", "outlook")

        fun hasAccess(ctx: Context) = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

        fun component(ctx: Context) = ComponentName(ctx, SpendListener::class.java)
    }
}
