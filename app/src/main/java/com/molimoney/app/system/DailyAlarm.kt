package com.molimoney.app.system

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** Fires once a day at the chosen hour to post Moli Wrapped. Inexact on purpose: kind to the battery. */
object DailyAlarm {
    private fun pi(ctx: Context) = PendingIntent.getBroadcast(
        ctx, 7, Intent(ctx, WrappedReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun schedule(ctx: Context, hour: Int) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        var t = LocalDate.now().atTime(hour, 0)
        if (!t.isAfter(LocalDateTime.now().plusMinutes(1))) t = t.plusDays(1)
        val at = t.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        am.setWindow(AlarmManager.RTC_WAKEUP, at, 10 * 60 * 1000L, pi(ctx))
    }

    fun cancel(ctx: Context) { ctx.getSystemService(AlarmManager::class.java)?.cancel(pi(ctx)) }

    /** Keep the alarm in sync with settings. */
    fun sync(ctx: Context) {
        val s = Repo.get(ctx).settings
        if (s.wrapped) schedule(ctx, s.wrappedHour) else cancel(ctx)
    }
}

class WrappedReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent?) {
        val s = Repo.get(ctx).settings
        if (!s.wrapped) return
        Notifier.wrapped(ctx)
        DailyAlarm.schedule(ctx, s.wrappedHour)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent?) { DailyAlarm.sync(ctx) }
}
