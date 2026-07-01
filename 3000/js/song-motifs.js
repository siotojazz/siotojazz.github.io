(() => {
    const motifStyles = `
        .song-motif {
            position: absolute;
            right: 58px;
            top: 50%;
            width: 26px;
            height: 26px;
            color: currentColor;
            opacity: 0;
            pointer-events: none;
            transform: translateY(-50%) scale(0.82);
            transition: opacity 0.24s ease, transform 0.24s ease;
            z-index: 3;
        }
        .song-motif svg {
            display: block;
            width: 100%;
            height: 100%;
            overflow: visible;
            filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.28));
        }
        .song-motif .motif-stroke {
            fill: none;
            stroke: currentColor;
            stroke-width: 1.55;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .song-motif .motif-fill {
            fill: currentColor;
        }
        .song-motif .motif-soft {
            opacity: 0.32;
        }
        .song-motif .motif-origin {
            transform-box: fill-box;
            transform-origin: center;
        }
        .song-motif .motif-root-branch {
            stroke: #fff;
            opacity: 0.82;
        }
        .song-motif .motif-root-seed,
        .song-motif .motif-root-main-left,
        .song-motif .motif-root-main-right,
        .song-motif .motif-root-main-center,
        .song-motif .motif-root-branches-left,
        .song-motif .motif-root-branches-right,
        .song-motif .motif-root-branches-center {
            transform-box: fill-box;
        }
        .song-motif .motif-root-seed {
            transform-origin: center;
        }
        .song-motif .motif-root-main-left {
            transform-origin: top right;
        }
        .song-motif .motif-root-main-right {
            transform-origin: top left;
        }
        .song-motif .motif-root-main-center,
        .song-motif .motif-root-branches-center {
            transform-origin: top center;
        }
        .song-motif .motif-root-branches-left {
            transform-origin: top right;
        }
        .song-motif .motif-root-branches-right {
            transform-origin: top left;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .song-motif {
            opacity: 0.94;
            transform: translateY(-50%) scale(1);
        }
        .current-song-name.has-player-motif {
            padding-right: 44px;
        }
        .current-song-name .song-motif--player {
            right: 10px;
            width: 28px;
            height: 28px;
            color: #fff;
            opacity: 0.92;
            transform: translateY(-50%) scale(1);
        }
        .current-song-name .song-motif--player svg {
            filter: drop-shadow(0 0 7px rgba(255, 255, 255, 0.32));
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-pulse {
            animation: motif-pulse 1.45s ease-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-spin {
            animation: motif-spin 4.8s linear infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-shimmer {
            animation: motif-shimmer 1.8s ease-in-out infinite alternate;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-drift {
            animation: motif-drift 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-flicker {
            animation: motif-flicker 1.4s steps(2, end) infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-rise {
            animation: motif-rise 2.2s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-glitch {
            animation: motif-glitch 1.1s steps(2, end) infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-grow {
            animation: motif-grow 2.4s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-grow-left {
            animation: motif-grow-left 2.6s ease-in-out infinite;
            transform-box: fill-box;
            transform-origin: top right;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-grow-right {
            animation: motif-grow-right 2.6s ease-in-out infinite;
            transform-box: fill-box;
            transform-origin: top left;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-sway {
            animation: motif-sway 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-route {
            animation: motif-route 2.1s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-bounce {
            animation: motif-bounce 1.7s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-wave {
            animation: motif-wave 1.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-wave-slow {
            animation: motif-wave-slow 2.35s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-wave-deep {
            animation: motif-wave-deep 2.85s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-rain {
            animation: motif-rain 0.95s linear infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-sink {
            animation: motif-sink 2.7s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-press {
            animation: motif-press 1.35s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-wind {
            animation: motif-wind 1.7s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-light {
            animation: motif-light 1.6s ease-in-out infinite alternate;
        }
        .player-basic.playing .song-motif--player .motif-pulse {
            animation: motif-pulse 1.45s ease-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-spin {
            animation: motif-spin 4.8s linear infinite;
        }
        .player-basic.playing .song-motif--player .motif-shimmer {
            animation: motif-shimmer 1.8s ease-in-out infinite alternate;
        }
        .player-basic.playing .song-motif--player .motif-drift {
            animation: motif-drift 2.8s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-flicker {
            animation: motif-flicker 1.4s steps(2, end) infinite;
        }
        .player-basic.playing .song-motif--player .motif-rise {
            animation: motif-rise 2.2s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-glitch {
            animation: motif-glitch 1.1s steps(2, end) infinite;
        }
        .player-basic.playing .song-motif--player .motif-grow {
            animation: motif-grow 2.4s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-grow-left {
            animation: motif-grow-left 2.6s ease-in-out infinite;
            transform-box: fill-box;
            transform-origin: top right;
        }
        .player-basic.playing .song-motif--player .motif-grow-right {
            animation: motif-grow-right 2.6s ease-in-out infinite;
            transform-box: fill-box;
            transform-origin: top left;
        }
        .player-basic.playing .song-motif--player .motif-sway {
            animation: motif-sway 2.8s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-route {
            animation: motif-route 2.1s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-bounce {
            animation: motif-bounce 1.7s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-wave {
            animation: motif-wave 1.8s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-wave-slow {
            animation: motif-wave-slow 2.35s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-wave-deep {
            animation: motif-wave-deep 2.85s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-rain {
            animation: motif-rain 0.95s linear infinite;
        }
        .player-basic.playing .song-motif--player .motif-sink {
            animation: motif-sink 2.7s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-press {
            animation: motif-press 1.35s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-wind {
            animation: motif-wind 1.7s ease-in-out infinite;
        }
        .player-basic.playing .song-motif--player .motif-light {
            animation: motif-light 1.6s ease-in-out infinite alternate;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-seed,
        .player-basic.playing .song-motif--player .motif-root-seed {
            animation: motif-root-seed 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-main-left,
        .player-basic.playing .song-motif--player .motif-root-main-left {
            animation: motif-root-main-left 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-main-right,
        .player-basic.playing .song-motif--player .motif-root-main-right {
            animation: motif-root-main-right 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-main-center,
        .player-basic.playing .song-motif--player .motif-root-main-center {
            animation: motif-root-main-center 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-branches-left,
        .player-basic.playing .song-motif--player .motif-root-branches-left {
            animation: motif-root-branches-left 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-branches-right,
        .player-basic.playing .song-motif--player .motif-root-branches-right {
            animation: motif-root-branches-right 2.8s ease-in-out infinite;
        }
        .player-basic.playing ~ .tab-nav ~ .tab-content .song-item.active .motif-root-branches-center,
        .player-basic.playing .song-motif--player .motif-root-branches-center {
            animation: motif-root-branches-center 2.8s ease-in-out infinite;
        }
        @keyframes motif-pulse {
            0% { opacity: 0.78; transform: scale(0.6); }
            70%, 100% { opacity: 0; transform: scale(1.42); }
        }
        @keyframes motif-spin {
            to { transform: rotate(360deg); }
        }
        @keyframes motif-shimmer {
            from { opacity: 0.38; transform: translateX(-1px); }
            to { opacity: 1; transform: translateX(1px); }
        }
        @keyframes motif-drift {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-2.5px); }
        }
        @keyframes motif-flicker {
            0%, 100% { opacity: 0.46; transform: scale(0.9) rotate(0deg); }
            50% { opacity: 1; transform: scale(1.08) rotate(8deg); }
        }
        @keyframes motif-rise {
            0%, 100% { transform: translateY(1.5px); }
            50% { transform: translateY(-2.5px); }
        }
        @keyframes motif-glitch {
            0%, 100% { transform: translateX(0); opacity: 0.92; }
            35% { transform: translateX(-1.5px); opacity: 0.62; }
            70% { transform: translateX(1.5px); opacity: 1; }
        }
        @keyframes motif-grow {
            0%, 100% { transform: scaleY(0.84); }
            50% { transform: scaleY(1.08); }
        }
        @keyframes motif-grow-left {
            0%, 100% { transform: scale(0.86) rotate(2deg); }
            50% { transform: scale(1.08) rotate(-5deg); }
        }
        @keyframes motif-grow-right {
            0%, 100% { transform: scale(0.86) rotate(-2deg); }
            50% { transform: scale(1.08) rotate(5deg); }
        }
        @keyframes motif-sway {
            0%, 100% { transform: rotate(-4deg); }
            50% { transform: rotate(5deg); }
        }
        @keyframes motif-route {
            0% { stroke-dashoffset: 18; opacity: 0.45; }
            50% { opacity: 1; }
            100% { stroke-dashoffset: 0; opacity: 0.72; }
        }
        @keyframes motif-bounce {
            0%, 100% { transform: translateY(0); }
            45% { transform: translateY(-3px); }
            70% { transform: translateY(1px); }
        }
        @keyframes motif-wave {
            0%, 100% { transform: translateX(-1.5px); }
            50% { transform: translateX(1.5px); }
        }
        @keyframes motif-wave-slow {
            0%, 100% { transform: translateX(1.5px) translateY(0); }
            50% { transform: translateX(-1.5px) translateY(-0.7px); }
        }
        @keyframes motif-wave-deep {
            0%, 100% { transform: translateX(-0.8px) translateY(0.6px); }
            50% { transform: translateX(1.8px) translateY(-0.4px); }
        }
        @keyframes motif-rain {
            0% { transform: translateY(-5px); opacity: 0; }
            35% { opacity: 0.95; }
            100% { transform: translateY(5px); opacity: 0.15; }
        }
        @keyframes motif-sink {
            0%, 100% { transform: translateY(-2px); opacity: 1; }
            55% { transform: translateY(4px); opacity: 0.32; }
        }
        @keyframes motif-press {
            0%, 100% { transform: translateY(-1px); }
            48%, 62% { transform: translateY(2px); }
        }
        @keyframes motif-wind {
            0%, 100% { transform: translateX(-2px); opacity: 0.45; }
            50% { transform: translateX(2px); opacity: 1; }
        }
        @keyframes motif-light {
            from { opacity: 0.22; transform: scaleX(0.76); }
            to { opacity: 0.78; transform: scaleX(1.08); }
        }
        @keyframes motif-root-seed {
            0%, 12% { opacity: 1; transform: scale(0.58); }
            44%, 82% { opacity: 0.74; transform: scale(1); }
            100% { opacity: 1; transform: scale(0.58); }
        }
        @keyframes motif-root-main-left {
            0%, 16% { opacity: 0; transform: scale(0.12) rotate(8deg); }
            48%, 82% { opacity: 1; transform: scale(1) rotate(0deg); }
            100% { opacity: 0; transform: scale(0.12) rotate(8deg); }
        }
        @keyframes motif-root-main-right {
            0%, 18% { opacity: 0; transform: scale(0.12) rotate(-8deg); }
            50%, 82% { opacity: 1; transform: scale(1) rotate(0deg); }
            100% { opacity: 0; transform: scale(0.12) rotate(-8deg); }
        }
        @keyframes motif-root-main-center {
            0%, 14% { opacity: 0; transform: scaleY(0.18); }
            44%, 82% { opacity: 0.92; transform: scaleY(1); }
            100% { opacity: 0; transform: scaleY(0.18); }
        }
        @keyframes motif-root-branches-left {
            0%, 36% { opacity: 0; transform: scale(0.16) rotate(5deg); }
            64%, 82% { opacity: 0.82; transform: scale(1) rotate(0deg); }
            100% { opacity: 0; transform: scale(0.16) rotate(5deg); }
        }
        @keyframes motif-root-branches-right {
            0%, 38% { opacity: 0; transform: scale(0.16) rotate(-5deg); }
            66%, 82% { opacity: 0.82; transform: scale(1) rotate(0deg); }
            100% { opacity: 0; transform: scale(0.16) rotate(-5deg); }
        }
        @keyframes motif-root-branches-center {
            0%, 40% { opacity: 0; transform: scale(0.18); }
            68%, 82% { opacity: 0.76; transform: scale(1); }
            100% { opacity: 0; transform: scale(0.18); }
        }
    `;

    const motifs = [
        {
            name: 'waves',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke motif-wave" d="M2.8 8.8c2.2-2.2 4.3-2.2 6.5 0s4.8 2.2 7.3-.2c1.4-1.3 2.8-1.8 4.6-.8"/><path class="motif-stroke motif-wave-slow" d="M3 13c2.7-2.8 5.1-2.8 7.8 0s5.2 2.8 10.2-.7"/><path class="motif-stroke motif-wave-deep motif-soft" d="M4 17.4c2.3-1.8 4.5-1.8 6.8 0s4.9 1.9 9.2-.4"/><circle class="motif-fill motif-soft motif-drift" cx="18.5" cy="9.3" r="1.15"/></svg>'
        },
        {
            name: 'bicycle-rain',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g class="motif-rain motif-soft"><path class="motif-stroke" d="M6 3.5 4.8 6M11 2.8 9.8 5.3M17 3.4 15.8 5.9"/></g><g class="motif-drift"><circle class="motif-stroke motif-spin motif-origin" cx="7.2" cy="16.3" r="3.2"/><circle class="motif-stroke motif-spin motif-origin" cx="16.8" cy="16.3" r="3.2"/><path class="motif-stroke" d="M7.2 16.3 10.5 10.5h3l3.3 5.8M10.5 10.5l2.1 5.8h-5.4M12.6 16.3l4.2-5.8M9.8 8.8h3.5M15.2 8.6h2.5"/></g></svg>'
        },
        {
            name: 'vanishing-sun',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke" d="M4 15.5h16"/><circle class="motif-fill motif-sink" cx="12" cy="11.2" r="4.2"/><path class="motif-stroke motif-soft motif-shimmer" d="M6 18h12M8 20h8"/></svg>'
        },
        {
            name: 'island-palms',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-fill motif-soft" d="M4 18.1c2.8-2.6 12.2-2.6 16 0-2.6 1.8-12.2 1.9-16 0Z"/><path class="motif-stroke" d="M4 18.1c2.8-2.6 12.2-2.6 16 0"/><path class="motif-stroke motif-soft" d="M8 16.9c1.5-.8 6.4-.9 8.2-.1"/><g class="motif-sway motif-origin"><path class="motif-stroke" d="M12 17.1c.7-4.3 1-7.1.4-9.6"/><path class="motif-stroke" d="M12.3 8c-2.1-.8-3.6-.3-5 1.2m5-.9c1.9-1.5 3.8-1.6 5.7-.4m-5.6.1c-1.2-2-2.5-2.8-4.3-2.8m4.5 2.8c1.4-2 3-2.6 4.9-2.2"/></g><path class="motif-stroke motif-wave-slow motif-soft" d="M5 20.7c3-1 5-1 8 0s4 1 7-.2"/></svg>'
        },
        {
            name: 'button-press',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><ellipse class="motif-fill motif-soft" cx="12" cy="17.2" rx="7.3" ry="2.2"/><path class="motif-stroke" d="M4.8 17.2c1.2 2 13.2 2 14.4 0"/><g class="motif-press motif-origin"><ellipse class="motif-fill motif-soft" cx="12" cy="10.7" rx="6.2" ry="2.3"/><path class="motif-stroke" d="M5.8 10.7c0-1.3 2.8-2.3 6.2-2.3s6.2 1 6.2 2.3-2.8 2.3-6.2 2.3-6.2-1-6.2-2.3Z"/><path class="motif-stroke" d="M5.8 10.8v3.7c0 1.3 2.8 2.3 6.2 2.3s6.2-1 6.2-2.3v-3.7"/><ellipse class="motif-stroke motif-soft" cx="12" cy="10.6" rx="2.5" ry=".9"/></g><path class="motif-stroke motif-flicker motif-soft" d="M12 4.8v2M8.8 5.8l1 1.4M15.2 5.8l-1 1.4"/></svg>'
        },
        {
            name: 'magic',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g class="motif-drift"><path class="motif-fill motif-soft" d="M3.4 13.8c3.5-3 9.1-5.6 14-5.8 2.3-.1 3.5.6 3.8 1.5.3.8-.8 1.5-2.9 1.8l-4.5.4-3.5 4.3-2.3-.5 1.7-3.4-4.2.5-2 1.5Z"/><path class="motif-stroke" d="M3.4 13.8c3.5-3 9.1-5.6 14-5.8 2.3-.1 3.5.6 3.8 1.5.3.8-.8 1.5-2.9 1.8l-12.8 1.3-2 1.5Z"/><path class="motif-stroke" d="M10 12.2 8 15.5l2.3.5 3.5-4.3M15.3 8.4 13.4 6h2.1l3.2 2.4M6.2 12.4 4.8 10.1h2l2.9 1.9"/><path class="motif-stroke motif-soft" d="M16.1 9.4h.1M13.9 9.9h.1M11.7 10.4h.1"/></g><g class="motif-spin motif-origin"><circle class="motif-stroke motif-soft" cx="17.5" cy="6.2" r="2.2"/><path class="motif-stroke" d="M15.7 4.9 13.8 3.8m5.5 3.7 1.9 1.1M15.5 7.4 13.6 8.7m5.7-4 1.9-1.3"/></g></svg>'
        },
        {
            name: 'mountain-wind',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-fill motif-soft motif-rise" d="M4.5 18 11 7l3 5 2-3 4.5 9Z"/><path class="motif-stroke" d="M4 18h16M4.5 18 11 7l3 5 2-3 4.5 9"/><path class="motif-stroke motif-wind" d="M5 8.5h6M3.8 11.3h8.2M15 6.8h4"/></svg>'
        },
        {
            name: 'camera-light',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-fill motif-soft motif-light" d="M13 10 22 6v12l-9-4Z"/><rect class="motif-stroke" x="3" y="8.2" width="10.2" height="7.6" rx="1.4"/><circle class="motif-stroke motif-shimmer" cx="8.1" cy="12" r="2"/><path class="motif-stroke motif-soft" d="M5.5 7 7 5.5h3L11.3 7"/></svg>'
        },
        {
            name: 'moon-lake',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-fill motif-soft motif-shimmer" d="M18.9 4.1c-2.2.3-3.8 2.2-3.8 4.4 0 1.6.9 3.1 2.2 3.8-2.7.1-5-2.1-5-4.9 0-2.6 2.1-4.8 4.8-4.8.7 0 1.3.2 1.8.5Z"/><path class="motif-stroke" d="M18.9 4.1c-2.2.3-3.8 2.2-3.8 4.4 0 1.6.9 3.1 2.2 3.8-2.7.1-5-2.1-5-4.9 0-2.6 2.1-4.8 4.8-4.8.7 0 1.3.2 1.8.5Z"/><path class="motif-stroke motif-soft" d="M13.4 13.1c1.3-.5 3.2-.5 4.5 0m-5.5 2.1c1.9-.7 4.8-.6 6.7 0"/><path class="motif-stroke motif-wave-slow" d="M4.2 16.8c3-1.2 5.8-1 8.4.2 2.7 1.2 5.1.9 7.7-.5"/><path class="motif-stroke motif-wave motif-soft" d="M4 19.5c2.5-1.2 5-1.1 7.5.1s5.4 1 8.5-.5"/><path class="motif-stroke" d="M3.8 21.1c5.6-.5 11.1-.4 16.4-.9"/></svg>'
        },
        {
            name: 'two-roots',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke" d="M4.3 10.1h15.4"/><g class="motif-sway motif-origin"><path class="motif-stroke" d="M8.6 10.1V6.8m6.8 3.3V6.8"/><path class="motif-fill motif-soft" d="M6.4 7c.7-2.9 3.7-2.9 4.4 0-1.2.9-3.1.9-4.4 0Zm6.8 0c.7-2.9 3.7-2.9 4.4 0-1.2.9-3.1.9-4.4 0Z"/><path class="motif-stroke" d="M6.4 7c.7-2.9 3.7-2.9 4.4 0m2.4 0c.7-2.9 3.7-2.9 4.4 0"/></g><g class="motif-root-main-left"><path class="motif-stroke" d="M8.6 10.1c-1.1 1.5-1.9 3.4-2.2 5.8-.1.8-.5 1.6-1.1 2.4"/><path class="motif-stroke" d="M8.6 10.2c.1 1.4.5 2.8 1.3 4.2.5.8.5 1.9-.1 3.1"/></g><g class="motif-root-branches-left"><path class="motif-stroke motif-root-branch" d="M7.7 12.1 6 13.5m1.1-2.7 2.1 1.3m-2.5 2.2-2.1-.4m1.9.3 1.9 1.1m-2.3.6-2.2 1.1m2.4-1.1 1.5 1.5m1.8-2.8 1.9-.8m-1.5 2 1.6 1m-5.2-4.7-1.2-.8m.8 6-1.4 1.2m4.8-1.2-.9 1.5M7.1 13.2l-2.6 1.2m4.1-.2 1.1 2.1"/></g><g class="motif-root-main-right"><path class="motif-stroke" d="M15.4 10.1c1.1 1.5 1.9 3.4 2.2 5.8.1.8.5 1.6 1.1 2.4"/><path class="motif-stroke" d="M15.4 10.2c-.1 1.4-.5 2.8-1.3 4.2-.5.8-.5 1.9.1 3.1"/></g><g class="motif-root-branches-right"><path class="motif-stroke motif-root-branch" d="M16.3 12.1l1.7 1.4m-1.1-2.7-2.1 1.3m2.5 2.2 2.1-.4m-1.9.3-1.9 1.1m2.3.6 2.2 1.1m-2.4-1.1-1.5 1.5m-1.8-2.8-1.9-.8m1.5 2-1.6 1m5.2-4.7 1.2-.8m-.8 6 1.4 1.2m-4.8-1.2.9 1.5m1.4-5.6 2.6 1.2m-4.1-.2-1.1 2.1"/></g></svg>'
        },
        {
            name: 'rest',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke" d="M4 16h16"/><circle class="motif-fill motif-drift" cx="12" cy="11" r="4"/><path class="motif-stroke motif-soft" d="M7 19c2-1 8-1 10 0"/></svg>'
        },
        {
            name: 'change',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke motif-spin motif-origin" d="M7 8.5A6 6 0 0 1 17.5 8l1.5-2m-2 9.5A6 6 0 0 1 6.5 16L5 18"/><path class="motif-stroke" d="M19 6v4h-4M5 18v-4h4"/></svg>'
        },
        {
            name: 'distance',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke motif-route" stroke-dasharray="18" d="M4 17c4-7 8 3 16-7"/><circle class="motif-fill motif-drift" cx="19" cy="10" r="1.8"/><path class="motif-stroke motif-soft" d="M4 19h16"/></svg>'
        },
        {
            name: 'destination',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke motif-bounce motif-origin" d="M12 4.5a5 5 0 0 1 5 5c0 4-5 9.5-5 9.5S7 13.5 7 9.5a5 5 0 0 1 5-5Z"/><circle class="motif-fill" cx="12" cy="9.5" r="1.7"/><path class="motif-stroke motif-soft" d="M8 20h8"/></svg>'
        },
        {
            name: 'sea',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="motif-stroke motif-wave" d="M3 14c2.5-3 5-3 7.5 0s5 3 10.5-1"/><path class="motif-stroke motif-wave motif-soft" d="M4 18c2-2 4-2 6 0s5 2 10-1"/><circle class="motif-fill motif-soft motif-drift" cx="17" cy="7" r="2"/></svg>'
        }
    ];

    function installStyles() {
        if (typeof document === 'undefined' || document.getElementById('song-motif-styles')) return;
        const style = document.createElement('style');
        style.id = 'song-motif-styles';
        style.textContent = motifStyles;
        document.head.appendChild(style);
    }

    function createSongMotif(trackIndex) {
        installStyles();
        const motif = motifs[trackIndex] || motifs[trackIndex % motifs.length];
        const motifEl = document.createElement('div');
        motifEl.className = 'song-motif';
        motifEl.dataset.motif = motif.name;
        motifEl.setAttribute('aria-hidden', 'true');
        motifEl.innerHTML = motif.svg;
        return motifEl;
    }

    window.SiotoJazzSongMotifs = {
        installStyles,
        motifs,
        createSongMotif
    };
    window.createSongMotif = createSongMotif;

    installStyles();
})();
