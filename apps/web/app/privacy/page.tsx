import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/Legal";
import { COMPANY, CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy · Haven" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated={LEGAL_UPDATED}>
      <p>
        Haven is a marketplace for live shopping, short videos and auctions, run by {COMPANY} (&ldquo;Haven&rdquo;, &ldquo;we&rdquo;). This policy explains what we collect when you use the Haven website or
        apps, why, who we share it with, and how to delete it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your account:</b> email address, name, handle, and password (stored only as a one-way hash). If you sign in with Apple or Google, we receive the account ID and email address they share with us. A profile photo and bio are optional.</li>
        <li><b>Orders:</b> the shipping addresses you enter, what you bought or sold, prices, and delivery and tracking updates.</li>
        <li><b>Payments:</b> handled by Stripe. Your card number goes straight to Stripe and never reaches Haven&rsquo;s servers. We keep the payment&rsquo;s status, amount and Stripe reference.</li>
        <li><b>What you post:</b> videos, captions, comments, live chat messages, product listings and photos, bids, and reports you file.</li>
        <li><b>Activity:</b> follows, likes, wishlist items, and video views. Views by signed-out visitors are counted with a one-way hash of the IP address that changes every day.</li>
        <li><b>Device and security:</b> the IP address and browser or app version used to sign in (to keep your account secure), and a push notification token if you turn notifications on.</li>
        <li><b>Sellers:</b> business name, store details, return address, shipping labels bought through Haven, and AI credit usage.</li>
      </ul>
      <p>We don&rsquo;t use advertising trackers or third-party analytics, and we don&rsquo;t sell or rent personal information.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To run your account, show your content, process orders and payments, and ship items.</li>
        <li>To send notifications and emails you&rsquo;ve allowed (you can change these in Settings).</li>
        <li>To keep Haven safe: prevent fraud, review reports, and enforce our <Link href="/terms" className="underline">Terms</Link>.</li>
        <li>To provide AI features you choose to use, such as writing a listing from a photo, the shopping assistant, AI voices and AI live hosts. Anything AI-generated is labelled.</li>
        <li>To meet legal obligations such as tax and sales records.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>We share only what each service needs to do its job for Haven:</p>
      <ul>
        <li><b>The other side of an order:</b> a seller sees the buyer&rsquo;s name and shipping address for orders they need to ship.</li>
        <li><b>Payments:</b> Stripe.</li>
        <li><b>Shipping:</b> Shippo or EasyPost and the carrier, to buy labels and track packages.</li>
        <li><b>AI providers</b>, only when you use an AI feature: Google (Gemini), Groq, Anthropic or OpenAI for text and photos; ElevenLabs or OpenAI for voices; Deepgram for transcription; HeyGen for AI avatars.</li>
        <li><b>Live video:</b> LiveKit streams live shows.</li>
        <li><b>Hosting and delivery:</b> Render (servers), Supabase (database and file storage), GitHub Pages (website), Resend (email), and Apple and Google for push notifications.</li>
        <li><b>The law:</b> when we&rsquo;re legally required to, or to protect people from harm.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is open. When you delete your account, we erase your name, email, handle, photo, bio, addresses, sign-in methods, push tokens, follows and notifications right away, and remove your videos,
        comments and chat messages from view. We keep records of orders and payments, without your personal details, for as long as tax and accounting law requires.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li><b>Delete your account</b> any time in the app (Me → Delete account) or on the website (<Link href="/settings/account" className="underline">Settings → Account</Link>).</li>
        <li><b>Block</b> people so you don&rsquo;t see each other, and <b>report</b> anything that breaks the rules.</li>
        <li><b>Turn off</b> push notifications and emails in Settings.</li>
        <li>Ask us for a copy of your information, or to correct it, by emailing <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
      </ul>

      <h2>Children</h2>
      <p>Haven isn&rsquo;t for children under 13, and you must be old enough to make purchases where you live to buy or sell. If you think a child has given us information, contact us and we&rsquo;ll delete it.</p>

      <h2>Security</h2>
      <p>Connections are encrypted, passwords are hashed, payment details stay with Stripe, and sign-in sessions can be revoked. No system is perfectly secure, so please use a strong, unique password.</p>

      <h2>Changes and contact</h2>
      <p>
        If we change this policy, we&rsquo;ll update the date above and tell you in the app for significant changes. Questions: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
