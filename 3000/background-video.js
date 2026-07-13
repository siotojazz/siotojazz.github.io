(() => {
    const script = document.currentScript;
    const source = new URL("background.mp4", script.src).href;
    const fadeDuration = 3.5;

    function initializeVideoBackground() {
        if (document.querySelector(".site-video-background")) return;

        const background = document.createElement("div");
        background.className = "site-video-background";
        background.setAttribute("aria-hidden", "true");

        const videos = [0, 1].map((index) => {
            const video = document.createElement("video");
            video.muted = true;
            video.playsInline = true;
            video.preload = "auto";
            video.src = source;
            if (index === 0) {
                video.autoplay = true;
                video.classList.add("is-active");
            }
            background.appendChild(video);
            return video;
        });

        document.body.prepend(background);

        let activeIndex = 0;
        let transitioning = false;

        function play(video) {
            return Promise.resolve(video.play()).catch(() => false);
        }

        async function crossfade() {
            if (transitioning) return;
            transitioning = true;

            const current = videos[activeIndex];
            const nextIndex = (activeIndex + 1) % videos.length;
            const next = videos[nextIndex];

            next.currentTime = 0;
            const started = await play(next);

            if (started === false) {
                current.loop = true;
                transitioning = false;
                return;
            }

            next.classList.add("is-active");
            current.classList.remove("is-active");

            window.setTimeout(() => {
                current.pause();
                current.currentTime = 0;
                activeIndex = nextIndex;
                transitioning = false;
            }, fadeDuration * 1000);
        }

        videos.forEach((video, index) => {
            video.addEventListener("timeupdate", () => {
                if (index !== activeIndex || !Number.isFinite(video.duration)) return;
                if (video.duration - video.currentTime <= fadeDuration + 0.4) crossfade();
            });

            video.addEventListener("ended", () => {
                if (index === activeIndex) crossfade();
            });
        });

        play(videos[0]);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeVideoBackground, { once: true });
    } else {
        initializeVideoBackground();
    }
})();
