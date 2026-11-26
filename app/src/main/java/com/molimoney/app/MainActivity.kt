package com.molimoney.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import com.molimoney.app.system.DailyAlarm
import com.molimoney.app.system.Notifier
import com.molimoney.app.system.Repo
import com.molimoney.app.ui.App
import com.molimoney.app.ui.theme.MoliTheme

class MainActivity : ComponentActivity() {
    /** Set when the app is opened from a notification ("wrapped" / "activity"). */
    private val pending = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = Repo.get(this)
        Notifier.channels(this)
        DailyAlarm.sync(this)
        if (savedInstanceState == null) pending.value = intent?.getStringExtra(EXTRA_OPEN)
        setContent { MoliTheme { App(store, pending.value) { pending.value = null } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_OPEN)?.let { pending.value = it }
    }

    companion object {
        const val EXTRA_OPEN = "open"
        const val OPEN_WRAPPED = "wrapped"
        const val OPEN_ACTIVITY = "activity"
    }
}
