/* global window */

window.__ModuleLoader__.load({
  id: 'dsh-p2p-sync',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    function P2PIcon({ size = 16, active = false }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: active ? '#38bdf8' : 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'square',
        strokeLinejoin: 'miter',
        style: { display: 'block', borderRadius: 0 },
      }, [
        h('rect', { key: 'r1', x: 2, y: 3, width: 7, height: 7, stroke: 'currentColor' }),
        h('rect', { key: 'r2', x: 15, y: 14, width: 7, height: 7, stroke: 'currentColor' }),
        h('path', { key: 'p1', d: 'M9 6.5h7.5a2 2 0 0 1 2 2V14', stroke: 'currentColor' }),
        h('path', { key: 'p2', d: 'M15 17.5H7.5a2 2 0 0 1-2-2V10', stroke: 'currentColor' }),
      ]);
    }

    function P2PGeneralRow() {
      const [status, setStatus] = useState(null);

      useEffect(() => {
        let mounted = true;
        const fetchStatus = () => {
          fetch('/api/p2p-sync/status')
            .then((r) => r.json())
            .then((data) => {
              if (mounted) setStatus(data);
            })
            .catch(() => {});
        };
        fetchStatus();
        const timer = setInterval(fetchStatus, 4000);
        return () => {
          mounted = false;
          clearInterval(timer);
        };
      }, []);

      const isConnected = !!status?.connected;
      const peerCount = status?.peers?.length || 0;

      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: '#111111',
          border: '1px solid #222222',
          borderRadius: 0,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '13px',
          color: '#eeeeee',
          margin: '8px 0',
        },
      }, [
        h('div', { key: 'info', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
          h('div', {
            key: 'indicator',
            style: {
              width: '10px',
              height: '10px',
              backgroundColor: isConnected ? '#10b981' : '#6b7280',
              borderRadius: 0,
            },
          }),
          h('span', { key: 'title', style: { fontWeight: 'bold' } }, 'P2P Sync:'),
          h('span', {
            key: 'label',
            style: { color: isConnected ? '#10b981' : '#9ca3af' },
          }, isConnected ? 'CONNECTED' : `LISTENING (${peerCount} peers configured)`),
        ]),
        h('span', {
          key: 'hint',
          style: { fontSize: '11px', color: '#6b7280' },
        }, status ? `Port: ${status.port}` : 'Checking...'),
      ]);
    }

    function P2PSettingsSection() {
      const [status, setStatus] = useState(null);
      const [loading, setLoading] = useState(true);
      const [syncing, setSyncing] = useState(false);
      const [syncFeedback, setSyncFeedback] = useState(null);
      const [newPeer, setNewPeer] = useState('');
      const [copied, setCopied] = useState(false);

      const fetchStatus = () => {
        fetch('/api/p2p-sync/status')
          .then((r) => r.json())
          .then((data) => {
            setStatus(data);
            setLoading(false);
          })
          .catch((err) => {
            setStatus({ error: err.message });
            setLoading(false);
          });
      };

      useEffect(() => {
        fetchStatus();
        const timer = setInterval(fetchStatus, 3000);
        return () => clearInterval(timer);
      }, []);

      const handleSync = (dryRun = false) => {
        setSyncing(true);
        setSyncFeedback(null);
        fetch('/api/p2p-sync/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun }),
        })
          .then((r) => r.json())
          .then((res) => {
            setSyncing(false);
            setSyncFeedback({ dryRun, ...res });
            fetchStatus();
          })
          .catch((err) => {
            setSyncing(false);
            setSyncFeedback({ error: err.message });
          });
      };

      const handleAddPeer = (e) => {
        e.preventDefault();
        if (!newPeer.trim()) return;
        fetch('/api/p2p-sync/peers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', peer: newPeer.trim() }),
        })
          .then((r) => r.json())
          .then(() => {
            setNewPeer('');
            fetchStatus();
          });
      };

      const handleRemovePeer = (peer) => {
        fetch('/api/p2p-sync/peers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove', peer }),
        })
          .then((r) => r.json())
          .then(() => {
            fetchStatus();
          });
      };

      const handleCopyId = () => {
        if (!status?.deviceId) return;
        navigator.clipboard.writeText(status.deviceId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };

      const isConnected = !!status?.connected;

      return h('div', {
        style: {
          padding: '24px',
          backgroundColor: '#0b0b0b',
          minHeight: '100%',
          fontFamily: "'JetBrains Mono', 'Space Mono', monospace",
          color: '#eeeeee',
          boxSizing: 'border-box',
          borderRadius: 0,
        },
      }, [
        // Title & Header
        h('div', { key: 'header', style: { marginBottom: '24px' } }, [
          h('h1', {
            key: 'title',
            style: {
              margin: '0 0 8px 0',
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: '1px',
              color: '#ffffff',
            },
          }, 'P2P REPLICATION'),
          h('p', {
            key: 'subtitle',
            style: { margin: 0, fontSize: '13px', color: '#9ca3af' },
          }, 'Direct peer-to-peer TCP synchronization without cloud servers, coordinators, or data loss.'),
        ]),

        // Connection Status Banner
        h('div', {
          key: 'status-banner',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            backgroundColor: isConnected ? '#06281e' : (status?.listenerError ? '#2a0e14' : '#141414'),
            border: `1px solid ${isConnected ? '#10b981' : (status?.listenerError ? '#ef4444' : '#222222')}`,
            marginBottom: '20px',
            borderRadius: 0,
          },
        }, [
          h('div', { key: 'left', style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            h('div', {
              key: 'dot',
              style: {
                width: '12px',
                height: '12px',
                backgroundColor: isConnected ? '#10b981' : (status?.listenerError ? '#ef4444' : '#6b7280'),
                borderRadius: 0,
              },
            }),
            h('div', { key: 'text' }, [
              h('div', {
                key: 'label',
                style: {
                  fontWeight: 700,
                  fontSize: '14px',
                  color: isConnected ? '#4ade80' : (status?.listenerError ? '#f87171' : '#e5e7eb'),
                },
              }, isConnected
                ? 'CONNECTED (PEER SYNC ACTIVE)'
                : (status?.listenerError ? 'PORT BUSY / LISTENER DEFERRED' : 'LISTENING (NO PEERS CONNECTED)')),
              h('div', {
                key: 'sub',
                style: { fontSize: '12px', color: '#9ca3af', marginTop: '2px' },
              }, status?.listenerError
                ? `Error: ${status.listenerError}`
                : `Listening on TCP port ${status?.port || 7421}`),
            ]),
          ]),
          h('div', {
            key: 'badge',
            style: {
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 'bold',
              border: `1px solid ${isConnected ? '#10b981' : '#333333'}`,
              backgroundColor: '#111111',
              color: isConnected ? '#10b981' : '#9ca3af',
              borderRadius: 0,
            },
          }, isConnected ? 'ONLINE' : 'STANDBY'),
        ]),

        // Device Identity Card
        h('div', {
          key: 'device-card',
          style: {
            padding: '16px 20px',
            backgroundColor: '#111111',
            border: '1px solid #222222',
            marginBottom: '20px',
            borderRadius: 0,
          },
        }, [
          h('div', {
            key: 'dev-title',
            style: { fontSize: '12px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '8px' },
          }, 'Local Device Identity'),
          h('div', {
            key: 'dev-row',
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
          }, [
            h('code', {
              key: 'dev-id',
              style: {
                fontSize: '13px',
                color: '#38bdf8',
                backgroundColor: '#071626',
                padding: '6px 10px',
                border: '1px solid #0e3054',
                wordBreak: 'break-all',
                borderRadius: 0,
              },
            }, status?.deviceId || 'Loading...'),
            h('button', {
              key: 'copy-btn',
              onClick: handleCopyId,
              style: {
                padding: '6px 14px',
                fontSize: '12px',
                backgroundColor: '#161616',
                color: copied ? '#10b981' : '#eeeeee',
                border: '1px solid #333333',
                cursor: 'pointer',
                borderRadius: 0,
              },
            }, copied ? 'COPIED!' : 'COPY ID'),
          ]),
        ]),

        // Peers Section
        h('div', {
          key: 'peers-card',
          style: {
            padding: '16px 20px',
            backgroundColor: '#111111',
            border: '1px solid #222222',
            marginBottom: '20px',
            borderRadius: 0,
          },
        }, [
          h('div', {
            key: 'peers-title',
            style: { fontSize: '12px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '12px' },
          }, `Configured Peers (${status?.peers?.length || 0})`),

          // Peers list
          h('div', { key: 'peers-list', style: { marginBottom: '16px' } },
            (!status?.peers || status.peers.length === 0)
              ? h('div', {
                key: 'empty',
                style: { padding: '12px', backgroundColor: '#161616', color: '#6b7280', fontSize: '13px' },
              }, 'No peers configured. Add your mobile phone or laptop IP below (e.g. 100.x.y.z:7421).')
              : status.peers.map((peer) => {
                const stat = status?.peerStatus?.[peer];
                const hasRecentSuccess = stat?.lastSuccess && (Date.now() - stat.lastSuccess < 15 * 60 * 1000);
                return h('div', {
                  key: peer,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    backgroundColor: '#161616',
                    border: '1px solid #222222',
                    marginBottom: '8px',
                    borderRadius: 0,
                  },
                }, [
                  h('div', { key: 'p-info', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
                    h('div', {
                      key: 'p-dot',
                      style: {
                        width: '8px',
                        height: '8px',
                        backgroundColor: hasRecentSuccess ? '#10b981' : (stat?.lastError ? '#ef4444' : '#6b7280'),
                        borderRadius: 0,
                      },
                    }),
                    h('span', { key: 'p-addr', style: { fontWeight: 700, fontSize: '13px' } }, peer),
                    h('span', {
                      key: 'p-stat',
                      style: { fontSize: '11px', color: hasRecentSuccess ? '#10b981' : (stat?.lastError ? '#ef4444' : '#6b7280') },
                    }, hasRecentSuccess ? 'SYNCED' : (stat?.lastError ? `FAIL: ${stat.lastError}` : 'IDLE')),
                  ]),
                  h('div', { key: 'p-actions', style: { display: 'flex', gap: '8px' } }, [
                    h('button', {
                      key: 'p-sync',
                      disabled: syncing,
                      onClick: () => handleSync(false),
                      style: {
                        padding: '4px 10px',
                        fontSize: '11px',
                        backgroundColor: '#1a2736',
                        color: '#38bdf8',
                        border: '1px solid #244160',
                        cursor: 'pointer',
                        borderRadius: 0,
                      },
                    }, 'SYNC'),
                    h('button', {
                      key: 'p-rm',
                      onClick: () => handleRemovePeer(peer),
                      style: {
                        padding: '4px 10px',
                        fontSize: '11px',
                        backgroundColor: '#2a1418',
                        color: '#f87171',
                        border: '1px solid #4a2026',
                        cursor: 'pointer',
                        borderRadius: 0,
                      },
                    }, 'REMOVE'),
                  ]),
                ]);
              })),

          // Add Peer Form
          h('form', {
            key: 'add-form',
            onSubmit: handleAddPeer,
            style: { display: 'flex', gap: '10px' },
          }, [
            h('input', {
              key: 'input',
              type: 'text',
              value: newPeer,
              placeholder: 'Enter peer address (e.g. 100.x.y.z:7421 or 192.168.1.50)',
              onChange: (e) => setNewPeer(e.target.value),
              style: {
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: "'JetBrains Mono', monospace",
                backgroundColor: '#161616',
                border: '1px solid #333333',
                color: '#ffffff',
                outline: 'none',
                borderRadius: 0,
              },
            }),
            h('button', {
              key: 'submit',
              type: 'submit',
              style: {
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: '#16202a',
                color: '#38bdf8',
                border: '1px solid #38bdf8',
                cursor: 'pointer',
                borderRadius: 0,
              },
            }, '+ ADD PEER'),
          ]),
        ]),

        // Manual Sync Triggers Card
        h('div', {
          key: 'sync-actions-card',
          style: {
            padding: '16px 20px',
            backgroundColor: '#111111',
            border: '1px solid #222222',
            borderRadius: 0,
          },
        }, [
          h('div', {
            key: 'act-title',
            style: { fontSize: '12px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '12px' },
          }, 'Replication Actions'),
          h('div', { key: 'btn-row', style: { display: 'flex', gap: '12px', marginBottom: '14px' } }, [
            h('button', {
              key: 'btn-sync-now',
              disabled: syncing || !status?.peers?.length,
              onClick: () => handleSync(false),
              style: {
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 700,
                backgroundColor: '#38bdf8',
                color: '#000000',
                border: 'none',
                cursor: syncing ? 'not-allowed' : 'pointer',
                borderRadius: 0,
              },
            }, syncing ? 'SYNCING...' : '⚡ SYNC NOW'),
            h('button', {
              key: 'btn-dry-run',
              disabled: syncing || !status?.peers?.length,
              onClick: () => handleSync(true),
              style: {
                padding: '10px 16px',
                fontSize: '13px',
                backgroundColor: '#161616',
                color: '#eeeeee',
                border: '1px solid #333333',
                cursor: syncing ? 'not-allowed' : 'pointer',
                borderRadius: 0,
              },
            }, 'DRY RUN (PREVIEW)'),
          ]),

          // Sync Feedback
          syncFeedback && h('div', {
            key: 'feedback',
            style: {
              padding: '12px 14px',
              backgroundColor: '#161616',
              border: '1px solid #244160',
              fontSize: '12px',
              borderRadius: 0,
            },
          }, [
            h('div', {
              key: 'fb-title',
              style: { fontWeight: 700, color: '#38bdf8', marginBottom: '4px' },
            }, syncFeedback.dryRun ? 'Dry Run Preview Result:' : 'Sync Completed:'),
            h('pre', {
              key: 'fb-json',
              style: { margin: 0, whiteSpace: 'pre-wrap', color: '#d1d5db', fontSize: '11px' },
            }, JSON.stringify(syncFeedback.results || syncFeedback, null, 2)),
          ]),
        ]),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // Register P2P Sync section in settings sidebar
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'p2p-sync',
          order: 85,
          label: 'P2P Sync',
        }, P2PSettingsSection));

        // Register custom icon for settings sidebar
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'p2p-sync',
        }, P2PIcon));

        // Register quick status row inside General Settings
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'p2p-sync-status',
          order: 35,
          label: 'P2P Sync',
        }, P2PGeneralRow));
      },
    };
  },
});
