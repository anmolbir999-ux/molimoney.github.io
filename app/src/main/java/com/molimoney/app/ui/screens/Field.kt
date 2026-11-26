package com.molimoney.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type

@Composable
fun Field(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val c = Moli.c
    val shape = RoundedCornerShape(14.dp)
    Box(modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.line, shape).padding(horizontal = 16.dp, vertical = 14.dp)) {
        if (value.isEmpty()) Text(placeholder, style = Type.body, color = c.faint)
        BasicTextField(
            value, onChange, singleLine = true, textStyle = Type.body.copy(color = c.ink), cursorBrush = SolidColor(c.clay),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
