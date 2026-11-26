package com.molimoney.app.system

import android.content.Context
import com.molimoney.app.data.Store

/** One shared store for the activity, the daily alarm and the notification listener. */
object Repo {
    @Volatile private var store: Store? = null
    fun get(ctx: Context): Store = store ?: synchronized(this) {
        store ?: Store(ctx.applicationContext).also { store = it }
    }
}
