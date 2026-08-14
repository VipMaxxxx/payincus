(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart 1: Failure Category Distribution ---
  var chart1 = echarts.init(document.getElementById('chart-categories'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} ({d}%)' },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: muted, fontSize: 13 },
      itemWidth: 14,
      itemHeight: 14
    },
    series: [{
      type: 'pie',
      radius: ['42%', '70%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: true,
      label: {
        show: true,
        formatter: '{c}',
        fontSize: 16,
        fontWeight: 'bold',
        color: ink
      },
      labelLine: { show: true, lineStyle: { color: rule } },
      data: [
        { value: 36, name: 'CRLF 换行符不匹配', itemStyle: { color: accent } },
        { value: 11, name: 'Windows 路径构造缺陷', itemStyle: { color: accent2 } },
        { value: 2, name: '真实代码/配置变更', itemStyle: { color: '#e8a838' } },
        { value: 1, name: '环境依赖缺失', itemStyle: { color: muted } }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: Pass vs Fail ---
  var chart2 = echarts.init(document.getElementById('chart-pass-fail'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' } },
    grid: { left: '10%', right: '10%', top: '15%', bottom: '15%' },
    xAxis: {
      type: 'category',
      data: ['通过', '失败'],
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: ink, fontSize: 14, fontWeight: 'bold' }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLabel: { color: muted, fontSize: 12 }
    },
    series: [{
      type: 'bar',
      barWidth: '45%',
      data: [
        { value: 129, itemStyle: { color: accent, borderRadius: [6, 6, 0, 0] } },
        { value: 50, itemStyle: { color: '#e85a5a', borderRadius: [6, 6, 0, 0] } }
      ],
      label: { show: true, position: 'top', color: ink, fontSize: 16, fontWeight: 'bold' }
    }]
  });
  window.addEventListener('resize', function() { chart2.resize(); });
})();
