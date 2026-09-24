# jednoduchý převodník na procenta jako data URL
import base64

# HTML kód převodníku
html = """<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prevodnik na procenta</title>
</head>
<body>
<h2>Prevodnik na procenta</h2>
<input id="num" type="number" step="any" placeholder="Zadejte číslo">
<select id="type">
  <option value="to">Na procenta</option>
  <option value="from">Z procent</option>
</select>
<button onclick="convert()">Převést</button>
<p id="result"></p>
<script>
function convert() {
  var v = parseFloat(document.getElementById('num').value);
  var type = document.getElementById('type').value;
  var res;
  if (isNaN(v)) {
    res = 'Neplatný vstup';
  } else if (type === 'to') {
    res = (v * 100).toFixed(2) + '%';
  } else {
    res = (v / 100).toFixed(4);
  }
  document.getElementById('result').textContent = res;
}
</script>
</body>
</html>"""

# zakódování do base64 a vytvoření data URL
data_url = 'data:text/html;base64,' + base64.b64encode(html.encode()).decode()

# výpis odkazu, který lze otevřít v mobilním prohlížeči
print(data_url)