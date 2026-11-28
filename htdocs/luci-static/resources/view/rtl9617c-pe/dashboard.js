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
	link.href = L.resource('rtl9617c-pe/pe.css') + '?v=20261128a';
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
				ui.addNotification(null, E('p', _('Operation failed: %s').format(res.error ? _(res.error) : _('Unknown error'))), 'warning');
			} else if (okMsg) {
				ui.addNotification(null, E('p', okMsg), 'info');
			}
			return self.refreshNow();
		}).catch(function(err) {
			self.busyAction = false;
			ui.addNotification(null, E('p', _('RPC error: %s').format(err && err.message ? err.message : String(err))), 'danger');
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
			wifiText = _('Wireless ready (%s) · WFO supported').format((wifi.phys || []).join(', '));
			wifiTone = 'good';
		} else if (wifi.present) {
			wifiText = _('Wireless detected (%s) · WFO firmware not installed').format((wifi.phys || []).join(', '));
			wifiTone = 'warn';
		} else {
			wifiText = _('No wireless NIC on this device (wired data-plane offload only)');
			wifiTone = '';
		}

		var modeLabel = st.mode === 'wifi_wfo'
			? _('Wi-Fi Hardware Offload')
			: (st.mode === 'off' ? _('All Off (Power Saving)') : _('General Wired Data-Plane Offload'));

		var summaryGrid = E('div', { 'class': 'rp-grid-3' }, [
			E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', _('PE Core Frequency')),
					badge(st.driver_loaded ? _('Driver Ready') : _('Driver Not Loaded'), st.driver_loaded ? 'good' : 'danger')
				]),
				E('div', { 'class': 'rp-kpi' }, fmtMhz(st.pe_clk_hz)),
				E('div', { 'class': 'rp-kpi-sub' }, _('PE AXI Bus: %s · %s').format(fmtMhz(st.peaxi_clk_hz), st.arch || 'Taroko MIPS-I'))
			]),
			E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', _('Current Operating Mode')),
					badge(modeLabel, anyRunning ? 'good' : '')
				]),
				E('div', { 'class': 'rp-kpi' }, String(activeFeatures.length) + ' / ' + String(features.length)),
				E('div', { 'class': 'rp-kpi-sub' }, _('Enabled non-exclusive offload features (idle cores are clock-gated automatically)'))
			]),
			E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', _('Wireless Offload Detection')),
					badge(wifi.wfo_available ? _('Available') : _('Unavailable'), wifiTone)
				]),
				E('div', { 'class': 'rp-note', 'style': 'margin-top:2px;font-size:13px;color:var(--rp-text)' }, wifiText),
				E('div', { 'class': 'rp-note' }, _('On wireless models in the same SoC family with WFO firmware installed, you can switch to Wi-Fi hardware offload here.'))
			])
		]);

		/* 2. Mode selection bar + One-click disable all */
		var modeCard = E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', _('PE Role Mode & One-Click Release')),
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'disabled': (!anyRunning && activeFeatures.length === 0) ? 'disabled' : null,
					'click': function() {
						self.runAction(callDisableAll(), _('All PE offload features disabled; PE0/PE1 have been reset and clock-gated.'));
					}
				}, _('Disable All & Save Power'))
			]),
			E('div', { 'class': 'rp-mode-bar' }, [
				E('button', {
					'class': 'rp-mode-btn' + (st.mode === 'off' ? ' is-active' : ''),
					'click': function() {
						self.runAction(callSetMode('off'), _('Switched to power-saving off mode; PE0/PE1 clock-gated.'));
					}
				}, _('Power Saving (All Off)')),
				E('button', {
					'class': 'rp-mode-btn' + (st.mode === 'offload' ? ' is-active' : ''),
					'click': function() {
						self.runAction(callSetMode('offload'), _('Switched to general wired data-plane offload mode.'));
					}
				}, _('General Data-Plane Offload (Shared)')),
				E('button', {
					'class': 'rp-mode-btn' + (st.mode === 'wifi_wfo' ? ' is-active' : ''),
					'disabled': wifi.wfo_available ? null : 'disabled',
					'title': wifi.wfo_available ? _('Assign PE0/PE1 to hardware Wi-Fi offload') : wifiText,
					'click': function() {
						self.runAction(callSetMode('wifi_wfo'), _('Switched to Wi-Fi hardware offload mode.'));
					}
				}, _('Hardware Wi-Fi Offload (WFO)'))
			]),
			E('p', { 'class': 'rp-note' },
				_('In "General Data-Plane Offload" mode, multiple wired offload features share the same bare-metal firmware without exclusive conflict. When a PE core has no active features, it is automatically reset and clock-gated (PD_OFFLOAD) to reduce power consumption and heat.'))
		]);

		/* 3. Per-core PE0 / PE1 cards */
		var coreCards = cores.map(function(c) {
			var isRun = c.state === 'running';
			var isFault = c.state === 'fault';
			var stBadge = isRun
				? badge(_('Running'), 'good')
				: (isFault ? badge(_('Fault Protected'), 'danger') : badge(c.clk_gated ? _('Clock-Gated') : _('Stopped'), ''));

			var coreFeats = features.filter(function(f) { return f.enabled && f.pe === c.core; });
			var pills = coreFeats.length
				? coreFeats.map(function(f) { return E('span', { 'class': 'rp-pill' }, _(f.name)); })
				: [ E('span', { 'class': 'rp-note', 'style': 'margin:0' }, isRun ? _('Idle Ready') : _('No features assigned (idle power-saving)')) ];

			var utilPct = isRun ? (Number(c.util_permille) || 0) : 0;

			return E('div', { 'class': 'rp-card' }, [
				E('div', { 'class': 'rp-card-head' }, [
					E('h3', _('PE%d Coprocessor').format(c.core)),
					E('div', { 'class': 'rp-actions' }, [
						stBadge,
						E('button', {
							'class': 'cbi-button cbi-button-action rp-btn-sm',
							'disabled': isRun ? null : 'disabled',
							'title': _('Run 8000 rounds of FNV-1a verification on PE%d to test real compute throughput and utilization reporting').format(c.core),
							'click': function() {
								self.runAction(
									callSelftest(c.core, 8000),
									_('PE%d MIPS-I self-test passed (CRC verified).').format(c.core)
								);
							}
						}, _('Self-Test'))
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
					E('div', {}, _('Uptime: %s').format(fmtUptime(c.uptime_ms))),
					E('div', {}, _('Watchdog Heartbeat: %s').format(String(c.heartbeat || 0))),
					E('div', {}, [ _('Feature Mask:'), ' ', E('span', { 'class': 'rp-mono' }, '0x' + (Number(c.feature_mask) || 0).toString(16)) ]),
					E('div', {}, _('DMA VP: %s').format(c.dma_vp_ready ? _('VP%s Ready').format(String(c.dma_vp_id)) : _('Unbound'))),
					E('div', {}, _('Enqueue / Bypass: %s / %s').format(fmtCount(c.dp_enq), fmtCount(c.dp_bypass)))
				])
			]);
		});

		/* 4. Feature occupancy table */
		var featRows = features.map(function(f) {
			var fName = _(f.name);
			var sel = E('select', {
				'class': 'rp-sel',
				'change': function(ev) {
					var newPe = parseInt(ev.target.value, 10);
					self.runAction(
						callSetFeature(f.id, f.enabled, newPe),
						_('Assigned "%s" to PE%d.').format(fName, newPe)
					);
				}
			}, [
				E('option', { 'value': '0', 'selected': f.pe === 0 ? 'selected' : null }, 'PE0'),
				E('option', { 'value': '1', 'selected': f.pe === 1 ? 'selected' : null }, 'PE1')
			]);

			var stCell;
			if (f.active && f.hw_bound)
				stCell = badge(_('Hardware Direct'), 'good');
			else if (f.active && !f.hw_bound)
				stCell = badge(_('Framework Placeholder'), 'warn');
			else if (f.enabled)
				stCell = badge(_('Standby'), 'warn');
			else
				stCell = badge(_('Disabled'), '');

			var statSub = (f.active && f.hw_bound)
				? E('div', { 'class': 'rp-note', 'style': 'margin-top:2px' },
					_('Queue %s · Drops %s · ECN %s').format(String(f.qdepth || 0), fmtCount(f.drops || 0), fmtCount(f.ecn_marks || 0)))
				: null;

			return E('tr', {}, [
				E('td', { 'class': 'rq-wrap rp-wrap' }, [
					E('strong', {}, fName),
					E('div', { 'class': 'rp-note', 'style': 'margin-top:2px' }, _(f.desc))
				]),
				E('td', {}, E('a', { 'href': L.url(f.module_url) }, _(f.module_title) + ' ↗')),
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
								_('Disabled PE offload for "%s".').format(fName)
							);
						}
					}, _('Disable'))
					: E('button', {
						'class': 'cbi-button cbi-button-positive rp-btn-sm',
						'disabled': st.driver_loaded ? null : 'disabled',
						'click': function() {
							self.runAction(
								callSetFeature(f.id, true, f.pe),
								_('Enabled on PE%d: "%s".').format(f.pe, fName)
							);
						}
					}, _('Enable')))
			]);
		});

		var featCard = E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', _('PE Feature Allocation (One-Click Disable & Live Core Migration)')),
				badge(_('%d active').format(activeFeatures.length), activeFeatures.length ? 'good' : '')
			]),
			E('div', { 'class': 'rp-table-wrap' }, [
				E('table', { 'class': 'rp-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, _('Offload Feature')),
						E('th', {}, _('Owner Module')),
						E('th', {}, _('Core')),
						E('th', {}, _('Status')),
						E('th', {}, _('Utilization')),
						E('th', {}, _('Packets / Traffic / AQM')),
						E('th', {}, _('Action'))
					])),
					E('tbody', {}, featRows)
				])
			])
		]);

		/* 5. Live PE ring log viewer */
		var logCard = E('div', { 'class': 'rp-card' }, [
			E('div', { 'class': 'rp-card-head' }, [
				E('h3', _('PE Bare-Metal Runtime Log (Live Ring Buffer)')),
				E('div', { 'class': 'rp-log-tabs' }, [
					E('button', {
						'type': 'button',
						'class': 'rp-tab-btn' + (self.activeLogCore === 0 ? ' is-active' : ''),
						'click': function() { self.activeLogCore = 0; self.refreshNow(); }
					}, _('PE0 Log')),
					E('button', {
						'type': 'button',
						'class': 'rp-tab-btn' + (self.activeLogCore === 1 ? ' is-active' : ''),
						'click': function() { self.activeLogCore = 1; self.refreshNow(); }
					}, _('PE1 Log'))
				])
			]),
			E('pre', { 'class': 'rp-log rp-mono' }, logText && logText.length ? logText : _('(No log output from this core yet)'))
		]);

		dom.content(self.dynNode || self.rootNode, [
			E('div', { 'class': 'rp-header' }, [
				E('div', {}, [
					E('div', { 'class': 'rp-eyebrow' }, 'RTL9617C TAURUS COPROCESSOR'),
					E('h2', {}, _('PE Coprocessor Dashboard')),
					E('div', { 'class': 'rp-note' }, _('Monitor PE0/PE1 real-time clocks, DMA VP hardware direct queues, and AQM drop/ECN counters with live core migration and power-saving clock gating.'))
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
				E('h3', _('PE FQ-CoDel & Multicast Data-Plane Parameters (1ns PTP Hardware Timer)')),
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
							_('Applied PE data-plane queue & shaping parameters (FQ Shaping=%d kbps, ECN=%d).').format(rq, ecn)
						);
					}
				}, _('Save & Apply Live'))
			]),
			E('div', { 'class': 'rp-param-grid' }, [
				E('label', { 'class': 'rp-param-field' }, [ E('span', {}, _('FQ-CoDel Shaping Rate (kbps, 0=unlimited)')), inpFqRate ]),
				E('label', { 'class': 'rp-param-field' }, [ E('span', {}, _('CoDel Target Delay (us)')), inpFqTarget ]),
				E('label', { 'class': 'rp-param-field' }, [ E('span', {}, _('Multicast Pacing Rate (kbps, 0=unlimited)')), inpMcastRate ]),
				E('label', { 'class': 'rp-param-check' }, [ inpEcn, E('span', {}, _('Enable ECN CE Marking')) ])
			]),
			E('div', { 'class': 'rp-note', 'style': 'margin-top:8px' },
				_('Tip: If your actual GPON/EPON uplink is around 250 Mbps and proxied uploads trigger upstream bufferbloat, set the FQ-CoDel shaping rate slightly below measured capacity (e.g. 235000 kbps) so the bottleneck queue stays inside PE CoDel. Set to 0 for 64-flow fair queueing and lossless pass-through.'))
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
				E('h3', {}, _('Unable to connect to luci.rtl9617c-pe service')),
				E('p', { 'class': 'rp-note' }, _('Please ensure rtl9617c-pe-offload is installed and restart rpcd.'))
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
