import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/Legal";
import { COMPANY, CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms · Haven" };

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated={LEGAL_UPDATED}>
      <p>
        These terms are an agreement between you and {COMPANY} about using Haven&rsquo;s website and apps. By creating an account or using Haven, you agree to them and to our{" "}
        <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>

      <h2>Zero tolerance for objectionable content and abuse</h2>
      <p>Haven has no tolerance for objectionable content or abusive people. You may not post, stream, sell, or send:</p>
      <ul>
        <li>harassment, bullying, threats, or hate based on who someone is</li>
        <li>sexual content or nudity, or anything that sexualizes minors</li>
        <li>violence, self-harm encouragement, or dangerous acts</li>
        <li>illegal, stolen, counterfeit, recalled, or prohibited items (including weapons, drugs, and alcohol or tobacco where not allowed)</li>
        <li>scams, spam, fake reviews, fake bids, or misleading listings</li>
        <li>other people&rsquo;s private information, or content you don&rsquo;t have the rights to</li>
      </ul>
      <p>
        You can report any video, comment, chat message, live stream, listing or person, and block anyone. Haven reviews reports within 24 hours. We remove content that breaks these rules and may suspend or close the
        accounts of people who post it.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 to use Haven, and old enough to make purchases where you live to buy or sell.</li>
        <li>Keep your sign-in details secure. You&rsquo;re responsible for activity on your account.</li>
        <li>You can delete your account at any time in Settings.</li>
      </ul>

      <h2>Buying and selling</h2>
      <ul>
        <li>Sellers are responsible for their listings being accurate and legal, for shipping what they sold, and for following the shipping and return terms they publish.</li>
        <li>Payments are processed by Stripe. Haven charges sellers a marketplace fee on each sale, shown in the seller dashboard.</li>
        <li>Bids in an auction are binding. If you win, you agree to pay.</li>
        <li>Shipping labels bought through Haven are charged to the seller.</li>
      </ul>

      <h2>AI features</h2>
      <p>
        Haven offers AI tools, such as writing listings from photos, a shopping assistant, AI voices and AI live hosts. AI can make mistakes, so sellers must check AI-written listings before publishing. AI hosts and voices are always
        labelled. Paid AI features use credits, at the prices shown in the seller dashboard.
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of what you post. You give Haven permission to host, show, and share it on Haven and in Haven&rsquo;s own promotion of your listings and shows, for as long as it&rsquo;s on Haven.
      </p>

      <h2>Ending things</h2>
      <p>We may suspend or close accounts that break these terms or put others at risk. You can stop using Haven at any time.</p>

      <h2>Disclaimers</h2>
      <p>
        Haven is provided &ldquo;as is&rdquo;. Sellers, not Haven, make and are responsible for the items they sell. To the extent the law allows, Haven isn&rsquo;t liable for indirect or consequential losses.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will change the date above when we do. Questions or concerns: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
