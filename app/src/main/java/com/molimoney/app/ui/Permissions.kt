package com.molimoney.app.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.molimoney.app.data.Store
import com.molimoney.app.system.DailyAlarm
import com.molimoney.app.system.Notifier
import com.molimoney.app.system.SpendListener

/** Returns a function that asks for notification permission (Android 13+) and then turns on the daily wrap-up. */
@Composable
fun rememberEnableWrapped(store: Store): () -> Unit {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        store.updateSettings { it.copy(wrapped = granted, askedNotif = true) }
        DailyAlarm.sync(ctx)
    }
    return {
        if (Notifier.canPost(ctx)) {
            store.updateSettings { it.copy(wrapped = true, askedNotif = true) }
            DailyAlarm.sync(ctx)
        } else if (Build.VERSION.SDK_INT >= 33) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

/** Opens the system screen where the user lets Moli read payment notifications. */
fun openListenerSettings(ctx: Context) {
    val detail = if (Build.VERSION.SDK_INT >= 30) Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, SpendListener.component(ctx).flattenToString()) else null
    val generic = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    runCatching { ctx.startActivity((detail ?: generic).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        .onFailure { runCatching { ctx.startActivity(generic.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
}

/** App info page, where sideloaded apps on Android 13+ can "Allow restricted settings". */
fun openAppInfo(ctx: Context) {
    runCatching {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
