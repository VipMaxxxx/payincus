(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var warn = style.getPropertyValue('--warn').trim();
  var danger = style.getPropertyValue('--danger').trim();

  // --- Chart 1: Issue Severity Distribution ---
  var chart1 = echarts.init(document.getElementById('chart-severity'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} 个' },
    grid: { left: '15%', right: '10%', top: '10%', bottom: '15%' },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLabel: { color: muted, fontSize: 12 }
    },
    yAxis: {
      type: 'category',
      data: ['严重', '中等', '低', '信息'],
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: ink, fontSize: 13, fontWeight: 'bold' }
    },
    series: [{
      type: 'bar',
      barWidth: '50%',
      data: [
        { value: 1, itemStyle: { color: danger, borderRadius: [0, 6, 6, 0] } },
        { value: 2, itemStyle: { color: warn, borderRadius: [0, 6, 6, 0] } },
        { value: 2, itemStyle: { color: accent2, borderRadius: [0, 6, 6, 0] } },
        { value: 3, itemStyle: { color: muted, borderRadius: [0, 6, 6, 0] } }
      ],
      label: { show: true, position: 'right', color: ink, fontSize: 14, fontWeight: 'bold', formatter: '{c} 个' }
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: Build Verification Results ---
  var chart2 = echarts.init(document.getElementById('chart-build'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c}' },
    legend: { bottom: 0, textStyle: { color: muted, fontSize: 12 }, itemWidth: 12, itemHeight: 12 },
    series: [{
      type: 'pie',
      radius: ['38%', '65%'],
      center: ['50%', '42%'],
      label: { show: true, formatter: '{b}\n{c}', fontSize: 13, color: ink, fontWeight: 'bold' },
      labelLine: { show: true, lineStyle: { color: rule } },
      data: [
        { value: 4, name: '通过', itemStyle: { color: accent } },
        { value: 0, name: '失败', itemStyle: { color: danger } }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart2.resize(); });
})();
