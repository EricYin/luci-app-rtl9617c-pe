'use strict';
'require view';
'require dom';
'require rpc';
'require poll';
'require ui';

var callStatus = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'status'
});

var callSetMode = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'set_mode',
	params: [ 'mode' ]
});

var callSetFeature = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'set_feature',
	params: [ 'id', 'enabled', 'pe' ]
});

var callSetParams = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'set_params',
	params: [ 'fq_rate_kbps', 'fq_target_us', 'fq_ecn', 'mcast_rate_kbps' ]
});

var callDisableAll = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'disable_all'
});

var callSelftest = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'selftest',
	params: [ 'core', 'iter' ]
});

var callGetLog = rpc.declare({
	object: 'luci.rtl9617c-pe',
	method: 'get_log',
	params: [ 'core' ]
});

function ensureCss() {
	if (document.getElementById('rtl9617c-pe-css'))
		return;
	var link = document.createElement('link');
	link.id = 'rtl9617c-pe-css';
	link.rel = 'stylesheet';
	link.href = L.resource('rtl9617c-pe/pe.css');
	document.head.appendChild(link);
}

function fmtMhz(hz) {
	var n = Number(hz) || 0;
	if (!n)
		return '-- MHz';
	return (n / 1000000).toFixed(1) + ' MHz';
}

function fmtPct(permille) {
	var p = Number(permille) || 0;
	if (p < 0) p = 0;
	if (p > 1000) p = 1000;
	return (p / 10).toFixed(1) + '%';
}

function fmtUptime(ms) {
	var sec = Math.floor((Number(ms) || 0) / 1000);
	if (sec <= 0)
		return '0s';
	var h = Math.floor(sec / 3600);
	var m = Math.floor((sec % 3600) / 60);
	var s = sec % 60;
	if (h > 0)
		return h + 'h ' + m + 'm ' + s + 's';
	if (m > 0)
		return m + 'm ' + s + 's';
	return s + 's';
}

function fmtCount(n) {
	n = Number(n) || 0;
	if (n >= 1000000000)
		return (n / 1000000000).toFixed(2) + 'G';
	if (n >= 1000000)
		return (n / 1000000).toFixed(2) + 'M';
	if (n >= 1000)
		return (n / 1000).toFixed(1) + 'K';
	return String(n);
}

function fmtBytes(b) {
	b = Number(b) || 0;
	if (b >= 1073741824)
		return (b / 1073741824).toFixed(2) + ' GiB';
	if (b >= 1048576)
		return (b / 1048576).toFixed(2) + ' MiB';
	if (b >= 1024)
		return (b / 1024).toFixed(1) + ' KiB';
	return b + ' B';
}

function badge(text, tone) {
	return E('span', { 'class': 'rp-badge' + (tone ? ' rp-' + tone : '') }, text);
}

function meterClass(permille) {
	if (permille >= 850)
		return 'rp-meter is-danger';
	if (permille >= 600)
		return 'rp-meter is-warn';
	return 'rp-meter is-good';
}

return view.extend({
	activeLogCore: 0,
	busyAction: false,

	load: function() {
		ensureCss();
		return Promise.all([
			callStatus().catch(function() { return null; }),
			callGetLog(0).catch(function() { return { log: '' }; })
		]);
	},

	runAction: function(promise, okMsg) {
		var self = this;
		if (self.busyAction)
			return;
		self.busyAction = true;
		return promise.then(function(res) {
			self.busyAction = false;
			if (res && res.ok === false) {
				ui.addNotification(null, E('p', '操作失败: ' + (res.error || '未知错误')), 'warning');
			} else if (okMsg) {
				ui.addNotification(null, E('p', okMsg), 'info');
			}
			return self.refreshNow();
		}).catch(function(err) {
			self.busyAction = false;
			ui.addNotification(null, E('p', '调用异常: ' + (err && err.message ? err.message : String(err))), 'danger');
		});
	},

	refreshNow: function() {
		var self = this;
		return Promise.all([
			callStatus().catch(function() { return null; }),
			callGetLog(self.activeLogCore).catch(function() { return { log: '' }; })
		]).then(function(res) {
			if (self.rootNode && res[0])
				self.renderDashboard(res[0], res[1] ? res[1].log : '');
		});
	},

	renderDashboard: function(st, logText) {
		var self = this;
		var wifi = st.wireless || {};
		var cores = st.cores || [];
		var features = st.features || [];

		var activeFeatures = features.filter(function(f) { return f.enabled; });
		var anyRunning = cores.some(function(c) { return c.state === 'running'; });

		/* 1. Top hardware KPI summary */
		var wifiText, wifiTone;
		if (wifi.wfo_available) {
			wifiText = '无线就绪 (' + (wifi.phys || []).join(', ') + ') · 支持 WFO';
			wifiTone = 'good';
		} else if (wifi.present) {
			wifiText = '检测到无线 (' + (wifi.phys || []).join(', ') + ') · 未装 WFO 固件';
			wifiTone = 'warn';
		} else {
			wifiText = '当前机型无无线网卡（仅启用有线数据面卸载）';
			wifiTone = '';
		}

		var modeLabel = st.mode === 'wifi_wfo'
			? 'Wi-Fi 硬件卸载'
			: (st.mode === 'off' ? '全部关闭（节能）' : '通用有线数据面卸载');

		var summaryGrid = E('div', { 'class': 'rp-grid-3' }, [
			E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', 'PE 核心频率'),
					badge(st.driver_loaded ? '驱动就绪' : '驱动未加载', st.driver_loaded ? 'good' : 'danger')
				]),
				E('div', { 'class': 'rp-kpi' }, fmtMhz(st.pe_clk_hz)),
				E('div', { 'class': 'rp-kpi-sub' }, 'PE AXI 总线: ' + fmtMhz(st.peaxi_clk_hz) + ' · ' + (st.arch || 'Taroko MIPS-I'))
			]),
			E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', '当前工作模式'),
					badge(modeLabel, anyRunning ? 'good' : '')
				]),
				E('div', { 'class': 'rp-kpi' }, String(activeFeatures.length) + ' / ' + String(features.length)),
				E('div', { 'class': 'rp-kpi-sub' }, '已启用非独占卸载功能数（空闲核自动关钟省电）')
			]),
			E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', '无线卸载探测'),
					badge(wifi.wfo_available ? '可用' : '不可用', wifiTone)
				]),
				E('div', { 'class': 'rp-note', 'style': 'margin-top:2px;font-size:13px;color:var(--rp-text)' }, wifiText),
				E('div', { 'class': 'rp-note' }, '同家族无线机型接入 WFO 固件后，可在此一键切换无线硬件卸载。')
			])
		]);

		/* 2. Mode selection bar + One-click disable all */
		var modeCard = E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', 'PE 角色模式与一键释放'),
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'disabled': (!anyRunning && activeFeatures.length === 0) ? 'disabled' : null,
					'click': function() {
						self.runAction(callDisableAll(), '已一键关闭所有 PE 卸载功能，PE0/PE1 已复位并关钟省电。');
					}
				}, '一键关闭全部并省电')
			]),
			E('div', { 'class': 'rp-mode-bar' }, [
				E('button', {
					'class': 'rp-mode-btn' + (st.mode === 'off' ? ' is-active' : ''),
					'click': function() {
						self.runAction(callSetMode('off'), '已切换为节能关闭模式，PE0/PE1 关钟。');
					}
				}, '节能关闭（全停）'),
				E('button', {
					'class': 'rp-mode-btn' + (st.mode === 'offload' ? ' is-active' : ''),
					'click': function() {
						self.runAction(callSetMode('offload'), '已切换为通用有线数据面卸载模式。');
					}
				}, '通用数据面卸载（非独占共存）'),
				E('button', {
					'class': 'rp-mode-btn' + (st.mode === 'wifi_wfo' ? ' is-active' : ''),
					'disabled': wifi.wfo_available ? null : 'disabled',
					'title': wifi.wfo_available ? '将 PE0/PE1 切换给硬件 Wi-Fi 卸载' : wifiText,
					'click': function() {
						self.runAction(callSetMode('wifi_wfo'), '已切换为 Wi-Fi 硬件卸载模式。');
					}
				}, '硬件 Wi-Fi 卸载 (WFO)')
			]),
			E('p', { 'class': 'rp-note' },
				'在“通用数据面卸载”模式下，多个有线卸载功能共享同一份裸机固件，无独占冲突；某颗 PE 没有任何功能占用时会自动复位并关闭其时钟（PD_OFFLOAD）以降低功耗与发热。')
		]);

		/* 3. Per-core PE0 / PE1 cards */
		var coreCards = cores.map(function(c) {
			var isRun = c.state === 'running';
			var isFault = c.state === 'fault';
			var stBadge = isRun
				? badge('运行中', 'good')
				: (isFault ? badge('故障已保护', 'danger') : badge(c.clk_gated ? '已关钟省电' : '已停止', ''));

			var coreFeats = features.filter(function(f) { return f.enabled && f.pe === c.core; });
			var pills = coreFeats.length
				? coreFeats.map(function(f) { return E('span', { 'class': 'rp-pill' }, f.name); })
				: [ E('span', { 'class': 'rp-note', 'style': 'margin:0' }, isRun ? '空载就绪' : '无功能占用（空闲省电）') ];

			var utilPct = isRun ? (Number(c.util_permille) || 0) : 0;

			return E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', 'PE' + c.core + ' 协处理器'),
					E('div', { 'class': 'rp-actions' }, [
						stBadge,
						E('button', {
							'class': 'cbi-button cbi-button-action rp-btn-sm',
							'disabled': isRun ? null : 'disabled',
							'title': '向 PE' + c.core + ' 发送 8000 轮 FNV-1a 校验以验证实机算力与占用率统计',
							'click': function() {
								self.runAction(
									callSelftest(c.core, 8000),
									'PE' + c.core + ' MIPS-I 自检通过（CRC 校验一致）。'
								);
							}
						}, '核自检')
					])
				]),
				E('div', { 'style': 'display:flex;align-items:baseline;justify-content:space-between;gap:10px' }, [
					E('div', { 'class': 'rp-kpi' }, fmtPct(utilPct)),
					E('div', { 'class': 'rp-kpi-sub' }, fmtMhz(c.pe_clk_hz || st.pe_clk_hz))
				]),
				E('div', { 'class': meterClass(utilPct) }, [
					E('span', { 'style': 'width:' + (utilPct / 10).toFixed(1) + '%' })
				]),
				E('div', { 'style': 'margin-top:6px;min-height:26px' }, pills),
				E('div', { 'class': 'rp-meta-row' }, [
					E('div', {}, [ 'PrId: ', E('span', { 'class': 'rp-mono' }, isRun ? (c.cp0_prid || '--') : '--') ]),
					E('div', {}, '运行时长: ' + fmtUptime(c.uptime_ms)),
					E('div', {}, '看门狗心跳: ' + String(c.heartbeat || 0)),
					E('div', {}, [ '特性掩码: ', E('span', { 'class': 'rp-mono' }, '0x' + (Number(c.feature_mask) || 0).toString(16)) ]),
					E('div', {}, 'DMA VP: ' + (c.dma_vp_ready ? ('VP' + c.dma_vp_id + ' 就绪') : '未绑定')),
					E('div', {}, '入队/旁路: ' + fmtCount(c.dp_enq) + ' / ' + fmtCount(c.dp_bypass))
				])
			]);
		});

		/* 4. Feature occupancy table */
		var featRows = features.map(function(f) {
			var sel = E('select', {
				'class': 'rp-sel',
				'change': function(ev) {
					var newPe = parseInt(ev.target.value, 10);
					self.runAction(
						callSetFeature(f.id, f.enabled, newPe),
						'已将「' + f.name + '」分配到 PE' + newPe + '。'
					);
				}
			}, [
				E('option', { 'value': '0', 'selected': f.pe === 0 ? 'selected' : null }, 'PE0'),
				E('option', { 'value': '1', 'selected': f.pe === 1 ? 'selected' : null }, 'PE1')
			]);

			var stCell;
			if (f.active && f.hw_bound)
				stCell = badge('硬件直通', 'good');
			else if (f.active && !f.hw_bound)
				stCell = badge('仅框架占位', 'warn');
			else if (f.enabled)
				stCell = badge('待机', 'warn');
			else
				stCell = badge('未启用', '');

			var statSub = (f.active && f.hw_bound)
				? E('div', { 'class': 'rp-note', 'style': 'margin-top:2px' },
					'队列 ' + (f.qdepth || 0) + ' · 丢包 ' + fmtCount(f.drops || 0) + ' · ECN ' + fmtCount(f.ecn_marks || 0))
				: null;

			return E('tr', {}, [
				E('td', { 'class': 'rq-wrap rp-wrap' }, [
					E('strong', {}, f.name),
					E('div', { 'class': 'rp-note', 'style': 'margin-top:2px' }, f.desc)
				]),
				E('td', {}, E('a', { 'href': L.url(f.module_url) }, f.module_title + ' ↗')),
				E('td', {}, sel),
				E('td', {}, stCell),
				E('td', { 'class': 'rp-mono' }, fmtPct(f.util_permille)),
				E('td', { 'class': 'rp-mono' }, [
					E('div', {}, fmtCount(f.packets) + ' / ' + fmtBytes(f.bytes)),
					statSub
				].filter(Boolean)),
				E('td', {}, f.enabled
					? E('button', {
						'class': 'cbi-button cbi-button-remove rp-btn-sm',
						'click': function() {
							self.runAction(
								callSetFeature(f.id, false, f.pe),
								'已关闭「' + f.name + '」的 PE 卸载。'
							);
						}
					}, '一键关闭')
					: E('button', {
						'class': 'cbi-button cbi-button-positive rp-btn-sm',
						'disabled': st.driver_loaded ? null : 'disabled',
						'click': function() {
							self.runAction(
								callSetFeature(f.id, true, f.pe),
								'已在 PE' + f.pe + ' 上启用「' + f.name + '」。'
							);
						}
					}, '启用'))
			]);
		});

		var featCard = E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', 'PE 功能占用明细（支持一键关闭与动态迁移核心）'),
				badge('共 ' + String(activeFeatures.length) + ' 项占用', activeFeatures.length ? 'good' : '')
			]),
			E('div', { 'class': 'rp-table-wrap' }, [
				E('table', { 'class': 'rp-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, '卸载功能'),
						E('th', {}, '归属模块'),
						E('th', {}, '挂载核'),
						E('th', {}, '状态'),
						E('th', {}, '功能占用率'),
						E('th', {}, '报文 / 流量 / AQM'),
						E('th', {}, '操作')
					])),
					E('tbody', {}, featRows)
				])
			])
		]);

		/* 5. Live PE ring log viewer */
		var logCard = E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', 'PE 裸机运行日志（实时环形缓冲）'),
				E('div', { 'class': 'rp-log-tabs' }, [
					E('button', {
						'type': 'button',
						'class': 'rp-tab-btn' + (self.activeLogCore === 0 ? ' is-active' : ''),
						'click': function() { self.activeLogCore = 0; self.refreshNow(); }
					}, 'PE0 日志'),
					E('button', {
						'type': 'button',
						'class': 'rp-tab-btn' + (self.activeLogCore === 1 ? ' is-active' : ''),
						'click': function() { self.activeLogCore = 1; self.refreshNow(); }
					}, 'PE1 日志')
				])
			]),
			E('pre', { 'class': 'rp-log rp-mono' }, logText && logText.length ? logText : '(当前核心暂无日志输出)')
		]);

		dom.content(self.dynNode || self.rootNode, [
			E('div', { 'class': 'rp-header' }, [
				E('div', {}, [
					E('div', { 'class': 'rp-eyebrow' }, 'RTL9617C TAURUS COPROCESSOR'),
					E('h2', {}, 'PE 协处理器看板'),
					E('div', { 'class': 'rp-note' }, '监控 PE0 / PE1 实时主频、DMA VP 硬件直通队列、AQM 丢包/ECN 统计，支持无重启热迁移与节能关钟。')
				])
			]),
			summaryGrid,
			modeCard,
			E('div', { 'class': 'rp-grid' }, coreCards),
			featCard,
			logCard
		]);
	},

	buildParamCard: function(st) {
		var self = this;
		var p = (st && st.params) || {};
		var inpFqRate = E('input', {
			'type': 'number', 'min': '0', 'max': '10000000', 'step': '1000',
			'class': 'cbi-input-text rp-param-input',
			'value': String(p.fq_rate_kbps != null ? p.fq_rate_kbps : 0)
		});
		var inpFqTarget = E('input', {
			'type': 'number', 'min': '100', 'max': '100000', 'step': '500',
			'class': 'cbi-input-text rp-param-input',
			'value': String(p.fq_target_us != null ? p.fq_target_us : 5000)
		});
		var inpMcastRate = E('input', {
			'type': 'number', 'min': '0', 'max': '10000000', 'step': '1000',
			'class': 'cbi-input-text rp-param-input',
			'value': String(p.mcast_rate_kbps != null ? p.mcast_rate_kbps : 0)
		});
		var inpEcn = E('input', {
			'type': 'checkbox',
			'checked': (p.fq_ecn === undefined || p.fq_ecn) ? 'checked' : null
		});

		return E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', 'PE FQ-CoDel 与组播数据面参数（1ns PTP 硬件定时）'),
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-apply',
					'click': function() {
						var rq = parseInt(inpFqRate.value, 10) || 0;
						var tq = parseInt(inpFqTarget.value, 10) || 5000;
						var mq = parseInt(inpMcastRate.value, 10) || 0;
						var ecn = inpEcn.checked ? 1 : 0;
						self.runAction(
							callSetParams(rq, tq, ecn, mq),
							'已应用 PE 数据面队列与整形参数（FQ 整形=' + rq + ' kbps, ECN=' + ecn + '）。'
						);
					}
				}, '保存并热生效')
			]),
			E('div', { 'class': 'rp-param-grid' }, [
				E('label', { 'class': 'rp-param-field' }, [ E('span', {}, 'FQ-CoDel 整形带宽 (kbps, 0=不限)'), inpFqRate ]),
				E('label', { 'class': 'rp-param-field' }, [ E('span', {}, 'CoDel 目标延迟 (us)'), inpFqTarget ]),
				E('label', { 'class': 'rp-param-field' }, [ E('span', {}, '组播平滑限速 (kbps, 0=不限)'), inpMcastRate ]),
				E('label', { 'class': 'rp-param-check' }, [ inpEcn, E('span', {}, '启用 ECN CE 标记') ])
			]),
			E('div', { 'class': 'rp-note', 'style': 'margin-top:8px' },
				'提示：若光猫上行实际带宽约 250 Mbps 且经代理上传触发上游缓存延迟飙升，可将 FQ-CoDel 整形带宽设为略低于实测上限（如 235000 kbps）以将瓶颈队列锁定在 PE CoDel 中；设为 0 则仅做 64 流公平调度与无损直发。')
		]);
	},

	render: function(data) {
		var self = this;
		var st = data && data[0];
		var logText = data && data[1] ? data[1].log : '';

		self.dynNode = E('div');
		self.paramNode = st ? self.buildParamCard(st) : E('div');
		self.rootNode = E('div', { 'class': 'rtlpe' }, [ self.dynNode, self.paramNode ]);
		if (st) {
			self.renderDashboard(st, logText);
		} else {
			dom.content(self.dynNode, E('div', { 'class': 'rp-card' }, [
				E('h3', {}, '无法连接 luci.rtl9617c-pe 服务'),
				E('p', { 'class': 'rp-note' }, '请确认已安装 rtl9617c-pe-offload 并重启 rpcd 服务。')
			]));
		}

		poll.add(function() {
			return self.refreshNow();
		}, 2);

		return self.rootNode;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
