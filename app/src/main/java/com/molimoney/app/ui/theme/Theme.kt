package com.molimoney.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

data class Palette(
    val bg: Color, val card: Color, val ink: Color, val muted: Color, val faint: Color,
    val line: Color, val clay: Color, val sage: Color, val ochre: Color, val onClay: Color, val dark: Boolean,
)

val Light = Palette(
    bg = Color(0xFFF6F4EE), card = Color(0xFFFDFCF9), ink = Color(0xFF1F1E1B), muted = Color(0xFF75716A),
    faint = Color(0xFFA9A59B), line = Color(0xFFE7E3D9), clay = Color(0xFFD9775A), sage = Color(0xFF6E9077),
    ochre = Color(0xFFC9963F), onClay = Color.White, dark = false,
)
val Dark = Palette(
    bg = Color(0xFF1E1D1A), card = Color(0xFF282723), ink = Color(0xFFEDEAE2), muted = Color(0xFF9F9B91),
    faint = Color(0xFF6E6A62), line = Color(0xFF3A3833), clay = Color(0xFFE38A6D), sage = Color(0xFF8DB096),
    ochre = Color(0xFFD9AB5C), onClay = Color(0xFF1E1D1A), dark = true,
)

val LocalPalette = staticCompositionLocalOf { Light }

object Moli {
    val c: Palette @Composable get() = LocalPalette.current
}

val Serif = FontFamily.Serif

object Type {
    val display = TextStyle(fontFamily = Serif, fontSize = 40.sp, lineHeight = 46.sp, fontWeight = FontWeight.Normal, letterSpacing = (-0.5).sp)
    val title = TextStyle(fontFamily = Serif, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Normal)
    val heading = TextStyle(fontFamily = Serif, fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.Medium)
    val body = TextStyle(fontSize = 15.sp, lineHeight = 22.sp)
    val small = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val label = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.4.sp)
}

@Composable
fun MoliTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val p = if (dark) Dark else Light
    val scheme = if (dark) darkColorScheme(primary = p.clay, background = p.bg, surface = p.card, onSurface = p.ink, onBackground = p.ink, surfaceContainerHigh = p.card, onPrimary = p.onClay)
    else lightColorScheme(primary = p.clay, background = p.bg, surface = p.card, onSurface = p.ink, onBackground = p.ink, surfaceContainerHigh = p.card, onPrimary = p.onClay)
    MaterialTheme(colorScheme = scheme, typography = Typography()) {
        CompositionLocalProvider(LocalPalette provides p, content = content)
    }
}
