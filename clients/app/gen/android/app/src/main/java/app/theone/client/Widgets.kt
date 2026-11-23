package app.theone.client

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.text.format.DateUtils
import android.util.Base64
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.PathParser
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.Switch
import androidx.glance.appwidget.SwitchDefaults
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider as Provider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.DateFormat
import java.util.Date
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// The widgets apps show on a Home Screen page, on the phone's own home screen: the person picks any widget they could
// put on a page in the app, touching and holding it to pick another, and it's drawn from what its tool answers, as the
// app draws it (core/ui/src/styled-components/widget.tsx), at small (2x2), medium (4x2) and large (4x4), light or dark
// with the phone. Its buttons and switches call their tools, and pressing it anywhere else opens the app at the widget's
// app. Each asks through the app's client (`Widgets_request` in src/session.rs), and is drawn again as Android's
// schedule says (`updatePeriodMillis`) and as the app opens and is left.

/** A widget there is to pick: one of the Home Screen's (`home-screen_pages`' `widgets`), by its `<app>/<tool>`. */
class Listed(val widget: String, val name: String, val sizes: List<String>, val entrypoint: String?, val app: String?) {
  val tool get() = widget.replace("/", "_")

  /** The size to draw it at for a widget `columns` by `rows`: that, or the nearest it comes in. */
  fun size(columns: Int, rows: Int): String {
    val wanted = if (columns < 4) "2x2" else if (rows < 4) "4x2" else "4x4"
    if (wanted in sizes) return wanted
    val order = listOf("2x2", "4x2", "4x4")
    return order.subList(0, order.indexOf(wanted)).reversed().firstOrNull { it in sizes } ?: sizes.firstOrNull() ?: wanted
  }

  companion object {
    fun read(widgets: JSONArray) = (0 until widgets.length()).map { index ->
      val widget = widgets.getJSONObject(index)
      val opens = widget.optJSONObject("opens")
      val sizes = widget.optJSONArray("sizes") ?: JSONArray()
      Listed(widget.getString("widget"), widget.optString("name"), (0 until sizes.length()).map(sizes::getString), opens?.optString("entrypoint"), opens?.optString("name"))
    }
  }
}

/** What the network answered: a result, or why there's none. */
sealed class Answer {
  class Result(val result: Any) : Answer()
  object SignedOut : Answer()
  class Failed(val why: String) : Answer()
}

class Widgets : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val widgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
    val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId)
    val first = grid(options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110), options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 110))
    val drawn = withContext(Dispatchers.IO) { draw(context, widgetId, first.first, first.second) }
    val at = asked.value
    provideContent {
      // A running widget is drawn again, not made again, as it's told to update or resized: what it shows is asked for
      // again here, at the size it's at.
      val size = LocalSize.current
      val cells = grid(size.width.value.roundToInt(), size.height.value.roundToInt())
      val now by asked.collectAsState()
      var shown by remember { mutableStateOf(drawn) }
      LaunchedEffect(now, cells) {
        if (now != at || cells != first) shown = withContext(Dispatchers.IO) { draw(context, widgetId, cells.first, cells.second) }
      }
      Card(context, shown, size.width.value.roundToInt())
    }
  }

  /** The Home Screen's columns and rows a widget `width` by `height` (dp) is: 2 or 4 each. */
  private fun grid(width: Int, height: Int) = (if (width >= 250) 4 else 2) to (if (height >= 250) 4 else 2)

  /** What a widget shows: its widget and layout, or why it shows none. */
  class Drawn(val listed: Listed? = null, val layout: JSONObject? = null, val problem: String? = null)

  companion object {
    init {
      System.loadLibrary("app")
    }

    /** Asks the network, through the app's client kept in `home`, for `method` with `params` (JSON), as JSON. */
    @JvmStatic external fun request(context: Context, home: String, method: String, params: String): String

    fun ask(context: Context, method: String, params: JSONObject): Answer {
      val answer = JSONObject(request(context, context.dataDir.absolutePath, method, params.toString()))
      return when {
        answer.optBoolean("signedOut") -> Answer.SignedOut
        answer.has("error") -> Answer.Failed(answer.getString("error"))
        else -> Answer.Result(answer.get("result"))
      }
    }

    /** Calls the app's tool `name` with `arguments`: what it answered, its structured content or the JSON its text is. */
    fun call(context: Context, name: String, arguments: JSONObject): Answer =
      when (val answer = ask(context, "tools/call", JSONObject().put("name", name).put("arguments", arguments))) {
        is Answer.Result -> {
          val result = answer.result as? JSONObject ?: JSONObject()
          val text = result.optJSONArray("content")?.optJSONObject(0)?.optString("text") ?: ""
          when {
            result.optBoolean("isError") -> Answer.Failed(text)
            result.has("structuredContent") -> Answer.Result(result.get("structuredContent"))
            else -> Answer.Result(runCatching { JSONObject(text) }.getOrDefault(text))
          }
        }
        else -> answer
      }

    private fun kept(context: Context) = context.getSharedPreferences("widgets", Context.MODE_PRIVATE)

    /** The widgets there are now, which are kept, so a widget finds its own without asking. */
    fun list(context: Context): Pair<List<Listed>?, String?> = when (val pages = call(context, "home-screen_pages", JSONObject())) {
      is Answer.Result -> {
        val widgets = (pages.result as? JSONObject)?.optJSONArray("widgets") ?: JSONArray()
        kept(context).edit().putString("listed", widgets.toString()).apply()
        Listed.read(widgets) to null
      }
      is Answer.SignedOut -> null to signedOut(context)
      is Answer.Failed -> null to "This widget stopped working. ${pages.why}"
    }

    fun signedOut(context: Context) = "Open ${context.getString(R.string.app_name)} and sign in to see this widget."

    fun chosen(context: Context, widgetId: Int): String? = kept(context).getString("chosen.$widgetId", null)

    fun choose(context: Context, widgetId: Int, widget: String) = kept(context).edit().putString("chosen.$widgetId", widget).apply()

    fun failed(context: Context, why: String?) = kept(context).edit().putString("failed", why).apply()

    /** The widget chosen, or with none yet the first there is, drawn `columns` by `rows`. */
    fun draw(context: Context, widgetId: Int, columns: Int, rows: Int): Drawn {
      val chosen = chosen(context, widgetId)
      var listed = kept(context).getString("listed", null)?.let { Listed.read(JSONArray(it)) } ?: emptyList()
      if (listed.isEmpty() || (chosen != null && listed.none { it.widget == chosen })) {
        val (now, problem) = list(context)
        listed = now ?: return Drawn(problem = problem)
      }
      val widget = (if (chosen != null) listed.firstOrNull { it.widget == chosen } else listed.firstOrNull())
        ?: return Drawn(problem = if (chosen == null) NONE else GONE)
      kept(context).getString("failed", null)?.let { failed(context, null); return Drawn(widget, problem = "This widget stopped working. $it") }
      return when (val layout = call(context, widget.tool, JSONObject().put("size", widget.size(columns, rows)))) {
        is Answer.Result -> Drawn(widget, layout.result as? JSONObject)
        is Answer.SignedOut -> Drawn(widget, problem = signedOut(context))
        is Answer.Failed -> {
          // A widget whose app is gone fails as its tool does: it's gone if it's no longer listed.
          val now = list(context).first
          if (now != null && now.none { it.widget == widget.widget }) Drawn(problem = GONE)
          else Drawn(widget, problem = "This widget stopped working. ${layout.why}")
        }
      }
    }

    private const val GONE = "This widget is gone. Touch and hold to choose another."
    const val NONE = "Your apps have no widgets yet."

    /** Told to ask again: each widget whose drawing Glance keeps running asks as this changes. */
    val asked = MutableStateFlow(0)

    /** Draws every widget again, as the app opens and is left, and once a control's call is answered. */
    fun redraw(context: Context) {
      asked.value++
      CoroutineScope(Dispatchers.Default).launch { runCatching { Widgets().updateAll(context.applicationContext) } }
    }
  }
}

class WidgetsReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = Widgets()

  /** Android's schedule asks again, as a running widget's drawing only would if told to. */
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    Widgets.asked.value++
    super.onUpdate(context, appWidgetManager, appWidgetIds)
  }
}

private val TOOL = ActionParameters.Key<String>("tool")
private val INPUTS = ActionParameters.Key<String>("inputs")

/** What a widget's button, switch or row calls: its app's tool, with its inputs; then every widget is drawn again. */
class CallTool : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val tool = parameters[TOOL] ?: return
    val inputs = JSONObject(parameters[INPUTS] ?: "{}")
    // A switch says its new state, which Glance gives it.
    parameters[androidx.glance.appwidget.action.ToggleableStateKey]?.let { inputs.put("on", it) }
    val answer = withContext(Dispatchers.IO) { Widgets.call(context, tool, inputs) }
    Widgets.failed(context, when (answer) {
      is Answer.Result -> null
      is Answer.SignedOut -> Widgets.signedOut(context)
      is Answer.Failed -> "${answer.why} Tap to try again."
    })
    Widgets.redraw(context)
  }
}

/** Where a widget is chosen: as it's added, and as it's touched and held. */
class WidgetChooser : Activity() {
  override fun onCreate(saved: Bundle?) {
    super.onCreate(saved)
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    val dark = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    val theme = if (dark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
    Thread {
      val (listed, problem) = Widgets.list(this)
      runOnUiThread {
        val dialog = AlertDialog.Builder(this, theme).setTitle("Choose a Widget").setOnCancelListener { finish() }
        if (listed.isNullOrEmpty()) {
          dialog.setMessage(problem ?: Widgets.NONE).setPositiveButton("OK") { _, _ -> finish() }
        } else {
          dialog.setItems(listed.map { listOfNotNull(it.name, it.app).distinct().joinToString(" · ") }.toTypedArray()) { _, index ->
            Widgets.choose(this, widgetId, listed[index].widget)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            Widgets.redraw(this)
            finish()
          }
        }
        dialog.show()
      }
    }.start()
  }
}

/** A colour of the tokens' (core/ui/src/tokens.ts), light and dark. */
private class Tint(val day: Color, val night: Color) {
  /** As it's drawn: faded to half where its part is. */
  fun provider(dim: Boolean = false): Provider =
    if (dim) ColorProvider(day = day.copy(alpha = day.alpha / 2), night = night.copy(alpha = night.alpha / 2)) else ColorProvider(day = day, night = night)

  fun faded(by: Float) = Tint(day.copy(alpha = day.alpha * by), night.copy(alpha = night.alpha * by))
}

private fun colour(light: Long, dark: Long) = Tint(Color(light), Color(dark))
private val LABEL = colour(0xFF1B1B1F, 0xFFFFFFFF)
private val SECONDARY = colour(0xB31B1B1F, 0x99FFFFFF)
private val QUATERNARY = colour(0x331B1B1F, 0x33FFFFFF)
private val QUINARY = colour(0x1A1B1B1F, 0x1AFFFFFF)
private val GREEN = colour(0xFF009A41, 0xFF30D158)
private val WHITE = colour(0xFFFFFFFF, 0xFFFFFFFF)
private val ORANGE = colour(0xFFC66000, 0xFFFF9F0A)
private val RED = colour(0xFFC51523, 0xFFFF7270)
/** The widget's tile: the text at 10% over the background, as the launcher draws one. */
private val CARD = colour(0xFFE1E1E4, 0xFF1A1A1A)

private fun tone(part: JSONObject): Tint? = when (part.optString("tone")) {
  "muted" -> SECONDARY
  "warn" -> ORANGE
  "bad" -> RED
  else -> null
}

private fun number(value: Any?): Double? = when (value) {
  is Number -> value.toDouble()
  is String -> value.toDoubleOrNull()
  else -> null
}

private fun share(value: Any?) = max(0.0, min(1.0, number(value) ?: 0.0))

/** What a part's drawn with: its widget's app, how wide the widget is, the colour its tone gives what's in it, and
 * whether it's faded. */
private class Drawing(val context: Context, val app: String, val width: Int, val colour: Tint, val dim: Boolean) {
  fun paint(tint: Tint) = tint.provider(dim)
}

@Composable
private fun Card(context: Context, drawn: Widgets.Drawn, width: Int) {
  val opens = drawn.listed?.entrypoint?.let {
    actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse("one:$it"), context, MainActivity::class.java))
  }
  val modifier = GlanceModifier.fillMaxSize().appWidgetBackground().background(CARD.provider()).cornerRadius(22.dp).padding(12.dp)
  Column(if (opens != null) modifier.clickable(opens) else modifier) {
    val layout = drawn.layout
    val name = drawn.listed?.name
    if (name != null && (drawn.problem != null || layout?.opt("title") != false)) {
      Text(name, maxLines = 1, style = TextStyle(color = SECONDARY.provider(), fontSize = 13.sp, fontWeight = FontWeight.Medium))
      Spacer(GlanceModifier.height(8.dp))
    }
    if (drawn.problem != null) Text(drawn.problem, style = TextStyle(color = LABEL.provider(), fontSize = 13.sp))
    else if (layout != null) {
      Part(layout, Drawing(context, drawn.listed?.widget?.substringBefore("/") ?: "", width, LABEL, false), GlanceModifier, root = true)
    }
  }
}

/** One part of a layout. A part this doesn't know draws nothing. `row` says it's in a row, where words keep to one
 * line; `first`, that it's the first in what it's in. */
@Composable
private fun Part(part: JSONObject, drawing: Drawing, room: GlanceModifier, root: Boolean = false, row: Boolean = false, first: Boolean = false) {
  val dim = drawing.dim || part.optBoolean("dim")
  val here = Drawing(drawing.context, drawing.app, drawing.width, tone(part) ?: drawing.colour, dim)
  val width = number(part.opt("width"))?.dp
  val sized = if (width != null) room.width(width) else room
  val colour = here.paint(here.colour)
  when (part.optString("part")) {
    "column", "row" -> if (fits(part, drawing.width)) Stack(part, here, sized, root)
    "text" -> Words(part.optString("text"), part, here, sized, row)
    "time" -> Words(time(number(part.opt("at")) ?: 0.0, part.optString("style")), part, here, sized, row)
    "stat" -> Column(sized) {
      Row(verticalAlignment = Alignment.Bottom) {
        Text(figure(part.opt("value")), maxLines = 1, style = TextStyle(color = colour, fontSize = 34.sp, fontWeight = FontWeight.Medium))
        if (part.has("unit")) {
          Spacer(GlanceModifier.width(4.dp))
          Text(part.optString("unit"), maxLines = 1, style = TextStyle(color = here.paint(SECONDARY), fontSize = 17.sp, fontWeight = FontWeight.Medium))
        }
      }
      if (part.has("label")) Small(part.optString("label"), here)
    }
    "gauge" -> {
      val size = number(part.opt("width")) ?: 46.0
      Box(room.size(size.dp), contentAlignment = Alignment.Center) {
        Shape(size, size, QUATERNARY, dim) { canvas, scale -> ring(canvas, size, scale, 1.0) }
        Shape(size, size, here.colour, dim) { canvas, scale -> ring(canvas, size, scale, share(part.opt("value"))) }
        if (part.has("label") && size >= 36) Text(part.optString("label"), maxLines = 1, style = TextStyle(color = here.paint(LABEL), fontSize = 13.sp, fontWeight = FontWeight.Medium))
      }
    }
    "progress" -> Column(sized) {
      if (part.has("label")) Small(part.optString("label"), here)
      val wide = number(part.opt("width")) ?: drawing.width - 24.0
      Box {
        Shape(wide, 8.0, QUATERNARY, dim) { canvas, scale -> bar(canvas, wide * scale, 8 * scale, 1.0) }
        Shape(wide, 8.0, here.colour, dim) { canvas, scale -> bar(canvas, wide * scale, 8 * scale, share(part.opt("value"))) }
      }
    }
    "spark" -> {
      val wide = number(part.opt("width")) ?: drawing.width - 24.0
      val tall = number(part.opt("height")) ?: 28.0
      Box(sized) {
        Shape(wide, tall, here.colour.faded(0.15f), dim) { canvas, scale -> spark(canvas, part, wide * scale, tall * scale, scale, area = true) }
        Shape(wide, tall, here.colour, dim) { canvas, scale -> spark(canvas, part, wide * scale, tall * scale, scale, area = false) }
      }
    }
    "chart" -> {
      val wide = number(part.opt("width")) ?: drawing.width - 24.0
      val tall = number(part.opt("height")) ?: 70.0
      val labels = part.optJSONArray("labels")
      Column(sized) {
        Shape(wide, tall - if (labels != null) 20 else 0, here.colour, dim) { canvas, scale -> chart(canvas, part, wide * scale, (tall - if (labels != null) 20 else 0) * scale, scale) }
        if (labels != null) Row(GlanceModifier.fillMaxWidth()) {
          for (index in 0 until labels.length()) {
            Text(labels.optString(index), maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = here.paint(SECONDARY), fontSize = 13.sp, textAlign = TextAlign.Center))
          }
        }
      }
    }
    "item" -> Item(part, here, sized, first)
    "image" -> {
      val url = part.optString("url")
      val bytes = if (url.startsWith("data:image/")) runCatching { Base64.decode(url.substringAfter(","), Base64.DEFAULT) }.getOrNull() else null
      val bitmap = bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
      val tall = number(part.opt("height"))?.dp
      var shaped = if (tall != null) sized.height(tall) else sized
      shaped = shaped.cornerRadius(if (part.optBoolean("round")) 9999.dp else 6.dp)
      if (bitmap != null) Image(ImageProvider(bitmap), contentDescription = null, contentScale = ContentScale.Crop, modifier = shaped)
      else Box(shaped.background(QUINARY.provider())) {}
    }
    "icon" -> {
      val size = number(part.opt("width")) ?: 16.0
      Box(room.size(size.dp)) {
        part.optString("path").takeIf { it.isNotEmpty() }?.let { path -> Shape(size, size, here.colour, dim) { canvas, scale -> svg(canvas, path, size * scale, 0.0, size * scale) } }
        part.optString("badge").takeIf { it.isNotEmpty() }?.let { badge ->
          val at = if (part.has("path")) size * 13 / 24 else 0.0
          Shape(size, size, here.colour, dim) { canvas, scale -> svg(canvas, badge, (size - at) * scale, at * scale, size * scale) }
        }
      }
    }
    "divider" -> Column(GlanceModifier.fillMaxWidth()) {
      Spacer(GlanceModifier.height(4.dp))
      Box(GlanceModifier.fillMaxWidth().height(1.dp).background(QUATERNARY.provider())) {}
      Spacer(GlanceModifier.height(4.dp))
    }
    "button" -> Box(
      sized.height(32.dp).padding(horizontal = 12.dp).cornerRadius(16.dp).background(QUINARY.provider()).clickable(calls(drawing.app, part, part.optJSONObject("inputs") ?: JSONObject())),
      contentAlignment = Alignment.Center,
    ) {
      Text(part.optString("label"), maxLines = 1, style = TextStyle(color = colour, fontSize = 15.sp, fontWeight = FontWeight.Medium))
    }
    "switch" -> Switch(
      checked = part.optBoolean("on"),
      onCheckedChange = calls(drawing.app, part, part.optJSONObject("inputs") ?: JSONObject()),
      text = part.optString("label"),
      modifier = sized,
      style = TextStyle(color = colour, fontSize = 15.sp),
      // The UI library's: green when on, with a white thumb, as iOS's is.
      colors = SwitchDefaults.colors(
        checkedThumbColor = WHITE.provider(), uncheckedThumbColor = WHITE.provider(),
        checkedTrackColor = GREEN.provider(), uncheckedTrackColor = QUATERNARY.provider(),
      ),
    )
  }
}

/** What a control calls: its app's tool, with its inputs. */
private fun calls(app: String, part: JSONObject, inputs: JSONObject) =
  actionRunCallback<CallTool>(actionParametersOf(TOOL to "${app}_${part.optString("tool")}", INPUTS to inputs.toString()))

/** A column or row with `from` is dropped where the widget is narrower than 15 or 18 rem, whole. */
private fun fits(part: JSONObject, width: Int) = when (part.optString("from")) {
  "md" -> width >= 288
  "sm" -> width >= 240
  else -> true
}

@Composable
private fun Stack(part: JSONObject, drawing: Drawing, room: GlanceModifier, root: Boolean) {
  val array = part.optJSONArray("parts") ?: JSONArray()
  val parts = (0 until array.length()).map(array::getJSONObject)
  val isRow = part.optString("part") == "row"
  val gap = (number(part.opt("gap")) ?: if (isRow) 8.0 else 4.0).dp
  val centred = part.optString("align") == "center"
  Children(parts, isRow, gap, centred, drawing, if (root && !isRow) room.fillMaxSize() else room)
}

/** What a row or column holds, `gap` apart. A row or column of Glance's holds 10 at most, so more go in nested ones of
 * 10, each taking the room that's left where something in it does. */
@Composable
private fun Children(parts: List<JSONObject>, isRow: Boolean, gap: Dp, centred: Boolean, drawing: Drawing, room: GlanceModifier) {
  val horizontal = if (centred) Alignment.CenterHorizontally else Alignment.Start
  // `weight` is the Row's or Column's own defaultWeight, which only its scope gives.
  val each: @Composable (List<JSONObject>, Int, GlanceModifier) -> Unit = { group, at, weight ->
    if (parts.size <= 10) Child(group[0], at, isRow, gap, centred, drawing, weight)
    else {
      // A nested group, the gap before it but the first.
      val grows = group.any { it.optBoolean("grow") }
      val nested = (if (isRow) GlanceModifier else GlanceModifier.fillMaxWidth()).let { if (grows) it.then(weight) else it }
      Box(if (at > 0) (if (isRow) nested.padding(start = gap) else nested.padding(top = gap)) else nested) {
        Children(group, isRow, gap, centred, drawing, if (isRow) GlanceModifier.fillMaxWidth() else GlanceModifier.fillMaxSize())
      }
    }
  }
  val groups = if (parts.size <= 10) parts.map { listOf(it) } else parts.chunked((parts.size + 9) / 10)
  if (isRow) Row(room, verticalAlignment = Alignment.CenterVertically, horizontalAlignment = horizontal) {
    groups.forEachIndexed { index, group -> each(group, index, GlanceModifier.defaultWeight()) }
  } else Column(room, horizontalAlignment = horizontal) {
    groups.forEachIndexed { index, group -> each(group, index, GlanceModifier.defaultWeight()) }
  }
}

/** One part of a row or column: the room it takes, the gap before it but the first, and what's in a column takes its
 * width, as a flex column stretches what it holds, unless it's centred. */
@Composable
private fun Child(inside: JSONObject, index: Int, isRow: Boolean, gap: Dp, centred: Boolean, drawing: Drawing, weight: GlanceModifier) {
  val grows = inside.optBoolean("grow")
  val across = if (isRow || centred) GlanceModifier else GlanceModifier.fillMaxWidth()
  if (index == 0) {
    Box(if (grows) across.then(weight) else across, contentAlignment = if (isRow) Alignment.CenterStart else Alignment.TopStart) {
      Part(inside, drawing, if (!grows) across else if (isRow) GlanceModifier.fillMaxWidth() else across.fillMaxHeight(), row = isRow, first = true)
    }
  } else {
    val spaced = if (isRow) across.padding(start = gap) else across.padding(top = gap)
    Box(if (grows) spaced.then(weight) else spaced, contentAlignment = if (isRow) Alignment.CenterStart else Alignment.TopStart) {
      Part(inside, drawing, if (!grows) across else if (isRow) GlanceModifier.fillMaxWidth() else across.fillMaxHeight(), row = isRow, first = false)
    }
  }
}

@Composable
private fun Words(text: String, part: JSONObject, drawing: Drawing, room: GlanceModifier, row: Boolean) {
  val size = when (part.optString("size")) {
    "xl" -> 34
    "lg" -> 28
    "sm", "xs" -> 13
    else -> 15
  }
  val weight = when (part.optString("weight")) {
    "medium" -> FontWeight.Medium
    "bold" -> FontWeight.Bold
    else -> if (size >= 28) FontWeight.Medium else FontWeight.Normal
  }
  val lines = if (row) 1 else number(part.opt("lines"))?.roundToInt()?.coerceIn(1, 8) ?: Int.MAX_VALUE
  // Words in a warning's tone are the label's colour; its orange is its symbols', bars' and gauges'.
  val colour = drawing.paint(if (part.optString("tone") == "warn") LABEL else drawing.colour)
  Text(text, maxLines = lines, modifier = room, style = TextStyle(color = colour, fontSize = size.sp, fontWeight = weight))
}

@Composable
private fun Small(text: String, drawing: Drawing) = Text(text, maxLines = 1, style = TextStyle(color = drawing.paint(SECONDARY), fontSize = 13.sp))

/** A row of a list, a hairline above it but the first. One that says `on` has a circle at its start, checked or not,
 * and with a `tool` it's pressed to switch. */
@Composable
private fun Item(part: JSONObject, drawing: Drawing, room: GlanceModifier, first: Boolean) {
  val colour = drawing.paint(drawing.colour)
  val pressed = if (part.has("tool")) {
    room.clickable(calls(drawing.app, part, JSONObject((part.optJSONObject("inputs") ?: JSONObject()).toString()).put("on", !part.optBoolean("on"))))
  } else room
  Column(pressed.fillMaxWidth()) {
    if (!first) Box(GlanceModifier.fillMaxWidth().height(1.dp).background(QUINARY.provider())) {}
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      if (part.has("on")) {
        val on = part.optBoolean("on")
        Shape(20.0, 20.0, if (on) LABEL else QUATERNARY, drawing.dim) { canvas, scale -> check(canvas, 20 * scale, on) }
        Spacer(GlanceModifier.width(8.dp))
      }
      Column(GlanceModifier.defaultWeight()) {
        Text(part.optString("title"), maxLines = 1, style = TextStyle(color = colour, fontSize = 15.sp))
        if (part.has("subtitle")) Small(part.optString("subtitle"), drawing)
      }
      val end = number(part.opt("at"))?.let { time(it, null) } ?: part.optString("trailing").takeIf { it.isNotEmpty() }
      if (end != null) {
        Spacer(GlanceModifier.width(8.dp))
        Text(end, maxLines = 1, style = TextStyle(color = drawing.paint(SECONDARY), fontSize = 15.sp))
      }
    }
  }
}

/** A shape `width` by `height` (dp), drawn white by `draw` at the screen's density, in `tint`, faded where `dim`. A
 * tint takes no alpha, so what's see-through of it is the shape's own. */
@Composable
private fun Shape(width: Double, height: Double, tint: Tint, dim: Boolean, draw: (Canvas, Double) -> Unit) {
  if (width <= 0 || height <= 0) return
  val scale = 3.0
  val bitmap = Bitmap.createBitmap((width * scale).roundToInt().coerceAtLeast(1), (height * scale).roundToInt().coerceAtLeast(1), Bitmap.Config.ALPHA_8)
  val canvas = Canvas(bitmap)
  canvas.saveLayerAlpha(null, (tint.day.alpha * (if (dim) 0.5f else 1f) * 255).roundToInt())
  draw(canvas, scale)
  canvas.restore()
  val opaque = Tint(tint.day.copy(alpha = 1f), tint.night.copy(alpha = 1f))
  Image(ImageProvider(bitmap), contentDescription = null, colorFilter = ColorFilter.tint(opaque.provider()), modifier = GlanceModifier.width(width.dp).height(height.dp))
}

private fun fill() = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE }

/** A ring `size` (dp) across filled to `share`, no thicker than a sixth of itself, from the top, clockwise, with round
 * ends. */
private fun ring(canvas: Canvas, size: Double, scale: Double, share: Double) {
  if (share <= 0) return
  val stroke = (min(5.0, size / 6) * scale).toFloat()
  val inset = stroke / 2
  val across = (size * scale).toFloat()
  val paint = fill().apply { style = Paint.Style.STROKE; strokeWidth = stroke; strokeCap = Paint.Cap.ROUND }
  canvas.drawArc(RectF(inset, inset, across - inset, across - inset), -90f, (360 * share).toFloat(), false, paint)
}

/** A pill filled to `share`. */
private fun bar(canvas: Canvas, width: Double, height: Double, share: Double) {
  if (share <= 0) return
  val end = max(height, width * share).toFloat()
  canvas.drawRoundRect(RectF(0f, 0f, end, height.toFloat()), height.toFloat() / 2, height.toFloat() / 2, fill())
}

private fun values(part: JSONObject): Pair<List<Double>, Double> {
  val values = part.optJSONArray("values")?.let { values -> (0 until values.length()).map { number(values.opt(it)) ?: 0.0 } } ?: emptyList()
  return values to (number(part.opt("max")) ?: max(values.maxOrNull() ?: 1.0, 1.0))
}

private fun along(values: List<Double>, max: Double, width: Double, height: Double, scale: Double) = values.mapIndexed { index, value ->
  (if (values.size > 1) index.toDouble() / (values.size - 1) * width else width / 2).toFloat() to
    (height - scale - min(value, max) / max * (height - 2 * scale)).toFloat()
}

/** A small line of values, or the area under it; with none, a dashed line. */
private fun spark(canvas: Canvas, part: JSONObject, width: Double, height: Double, scale: Double, area: Boolean) {
  val (values, max) = values(part)
  if (values.size < 2) {
    if (!area) for (x in 0 until (width / (5 * scale)).toInt()) canvas.drawRect((x * 5 * scale).toFloat(), (height / 2 - 0.75 * scale).toFloat(), ((x * 5 + 2) * scale).toFloat(), (height / 2 + 0.75 * scale).toFloat(), fill())
    return
  }
  val points = along(values, max, width, height, scale)
  val path = Path().apply { moveTo(points[0].first, points[0].second); points.drop(1).forEach { lineTo(it.first, it.second) } }
  if (area) {
    path.lineTo(width.toFloat(), height.toFloat()); path.lineTo(0f, height.toFloat()); path.close()
    canvas.drawPath(path, fill())
  } else {
    canvas.drawPath(path, fill().apply { style = Paint.Style.STROKE; strokeWidth = (1.5 * scale).toFloat() })
  }
}

/** Bars of values, each in its own slot at three fifths of its width, or with `kind: "line"` a line. */
private fun chart(canvas: Canvas, part: JSONObject, width: Double, height: Double, scale: Double) {
  val (values, max) = values(part)
  if (part.optString("kind") == "line") return spark(canvas, part, width, height, scale, area = false)
  val slot = width / max(values.size, 1)
  values.forEachIndexed { index, value ->
    val tall = min(value, max) / max * height
    if (tall > 0) {
      val radius = min(3 * scale, min(slot * 0.3, tall / 2)).toFloat()
      canvas.drawRoundRect(RectF((index * slot + slot * 0.2).toFloat(), (height - tall).toFloat(), (index * slot + slot * 0.8).toFloat(), height.toFloat()), radius, radius, fill())
    }
  }
}

/** A circle, checked or not: a ring, or a disc with a tick cut out of it. */
private fun check(canvas: Canvas, size: Double, on: Boolean) {
  val s = (size / 20).toFloat()
  if (!on) return canvas.drawCircle(10 * s, 10 * s, 9.375f * s, fill().apply { style = Paint.Style.STROKE; strokeWidth = 1.25f * s })
  canvas.drawCircle(10 * s, 10 * s, 10 * s, fill())
  val tick = Path().apply { moveTo(5.5f * s, 10.5f * s); lineTo(8.6f * s, 13.6f * s); lineTo(14.5f * s, 7f * s) }
  canvas.drawPath(tick, Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE; strokeWidth = 1.75f * s
    xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.CLEAR)
  })
}

/** An SVG path in its box of 24, `size` across, at `at` across and down. */
private fun svg(canvas: Canvas, data: String, size: Double, at: Double, @Suppress("UNUSED_PARAMETER") whole: Double) {
  val path = runCatching { PathParser.createPathFromPathData(data) }.getOrNull() ?: return
  canvas.save()
  canvas.translate(at.toFloat(), at.toFloat())
  canvas.scale((size / 24).toFloat(), (size / 24).toFloat())
  canvas.drawPath(path, fill())
  canvas.restore()
}

private fun figure(value: Any?): String = when (value) {
  is Number -> NumberFormat.getNumberInstance().apply { maximumFractionDigits = 2 }.format(value)
  is String -> value
  else -> "–"
}

/** When something was, as the Home Screen says it: a while ago in minutes, hours or days, a clock or a date. */
private fun time(at: Double, style: String?): String {
  val date = Date(at.toLong())
  return when (style) {
    "date" -> DateFormat.getDateInstance(DateFormat.MEDIUM).format(date)
    "clock" -> DateFormat.getTimeInstance(DateFormat.SHORT).format(date)
    else -> {
      val ago = abs(System.currentTimeMillis() - at)
      val unit = if (ago < 3_600_000) DateUtils.MINUTE_IN_MILLIS else if (ago < 86_400_000) DateUtils.HOUR_IN_MILLIS else DateUtils.DAY_IN_MILLIS
      DateUtils.getRelativeTimeSpanString(at.toLong(), System.currentTimeMillis(), unit, DateUtils.FORMAT_ABBREV_RELATIVE).toString()
    }
  }
}
