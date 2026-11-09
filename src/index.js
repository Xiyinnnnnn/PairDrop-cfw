// Worker 入口：/server 走 Durable Object 信令；/ip、/config 与上游同路径；其余交给静态资源

import {SignalingServer} from "./signaling.js";

export {SignalingServer};

const BUTTON = (active, link, title) => ({
    active: active === "true",
    link: link || undefined,
    title: title || undefined,
});

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === "/server") {
            const id = env.SIGNALING.idFromName("pairdrop-singleton");
            return env.SIGNALING.get(id).fetch(request);
        }

        if (url.pathname === "/ip") {
            return new Response(request.headers.get("cf-connecting-ip") || "", {
                headers: {"content-type": "text/plain; charset=utf-8"},
            });
        }

        if (url.pathname === "/config") {
            return Response.json({
                signalingServer: env.SIGNALING_SERVER || false,
                buttons: {
                    donation_button: BUTTON(env.DONATION_BUTTON_ACTIVE, env.DONATION_BUTTON_LINK, env.DONATION_BUTTON_TITLE),
                    twitter_button: BUTTON(env.TWITTER_BUTTON_ACTIVE, env.TWITTER_BUTTON_LINK, env.TWITTER_BUTTON_TITLE),
                    mastodon_button: BUTTON(env.MASTODON_BUTTON_ACTIVE, env.MASTODON_BUTTON_LINK, env.MASTODON_BUTTON_TITLE),
                    bluesky_button: BUTTON(env.BLUESKY_BUTTON_ACTIVE, env.BLUESKY_BUTTON_LINK, env.BLUESKY_BUTTON_TITLE),
                    custom_button: BUTTON(env.CUSTOM_BUTTON_ACTIVE, env.CUSTOM_BUTTON_LINK, env.CUSTOM_BUTTON_TITLE),
                    privacypolicy_button: BUTTON(env.PRIVACYPOLICY_BUTTON_ACTIVE, env.PRIVACYPOLICY_BUTTON_LINK, env.PRIVACYPOLICY_BUTTON_TITLE),
                },
            });
        }

        return env.ASSETS.fetch(request);
    },
};
