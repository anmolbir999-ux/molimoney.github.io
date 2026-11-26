package com.molimoney.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.molimoney.app.data.Store
import com.molimoney.app.ui.App
import com.molimoney.app.ui.theme.MoliTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = store ?: Store(applicationContext).also { store = it }
        setContent { MoliTheme { App(store) } }
    }
    companion object { private var store: Store? = null }
}
