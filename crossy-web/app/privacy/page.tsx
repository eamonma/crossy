import React from 'react'
import { Heading } from '@radix-ui/themes'
import Link from 'next/link'

import CrossyLogo from '@/components/crossyLogo'

import MainThemeSwitcher from '../mainThemeSwitcher'

const Page = () => {
  return (
    <div>
      <main className="flex flex-col min-h-screen bg-gray-50">
        <div className="p-4 pb-0">
          <header className="flex items-center justify-between h-12 px-5 border border-gray-300 rounded-md bg-gray-25">
            <Link href="/">
              <h1 className="flex items-center gap-1 font-serif text-lg font-bold">
                <div className="w-6 h-6 text-white rounded-full bg-gold-800 p-0.5">
                  <CrossyLogo />
                </div>
                Crossy
              </h1>
            </Link>
            <div className="flex items-center gap-4 font-medium">
              <MainThemeSwitcher isLoggedIn={false} />
            </div>
          </header>
        </div>
        <div className="flex items-stretch flex-1 h-full p-4">
          <div className="relative flex flex-col w-full overflow-hidden border border-gray-300 rounded-md shadow-sm bg-gold-25 group p-5 gap-2">
            <Heading size="5">Privacy policy for Crossy</Heading>
            <p>
              Last Updated: <time>2023-12-11</time>
            </p>
            <div className="max-w-prose flex gap-4 flex-col mt-4 m-auto mb-8">
              <Heading size="5">1. Introduction</Heading>
              <p>
                Welcome to Crossy. This Privacy Policy explains our practices
                regarding the collection, use, and disclosure of your
                information through our service. By accessing or using Crossy,
                you signify your understanding of and agreement with this
                Privacy Policy.
              </p>

              <Heading size="5">2. Information Collection</Heading>
              <p>
                We collect information provided by OAuth/social login providers,
                including but not limited to your name, email address, and
                profile picture. Crossy automatically collects certain
                information about your interaction with our services, such as
                usage data, device information, and IP addresses. We may also
                collect information you voluntarily submit, such as crossword
                puzzle content and user-generated content.
              </p>

              <Heading size="5">3. Use of Information</Heading>
              <p>
                Information collected is used to provide, maintain, and improve
                our services, to personalize your user experience, and to
                communicate with you. We may use your information for internal
                purposes such as auditing, data analysis, and research to
                enhance Crossy's services. Your information may be used for
                legal reasons, such as complying with applicable laws,
                regulations, legal processes, or governmental requests.
              </p>

              <Heading size="5">4. Information Sharing and Disclosure</Heading>
              <p>
                Crossy does not share personal information with third parties
                for their marketing purposes. We may disclose information to
                service providers, contractors, or agents who perform services
                on our behalf. Information may be disclosed if required by law,
                such as to comply with a subpoena or similar legal process.
              </p>

              <Heading size="5">5. Data Storage and Security</Heading>
              <p>
                We implement a variety of security measures to maintain the
                safety of your personal information when you enter, submit, or
                access your personal information. Despite these measures, no
                method of transmission over the Internet or method of electronic
                storage is 100% secure.
              </p>

              <Heading size="5">6. Third-Party Services</Heading>
              <p>
                This Privacy Policy does not apply to services offered by third
                parties, including products or sites that may be displayed to
                you in Crossy. We have no control over and assume no
                responsibility for the content, privacy policies, or practices
                of any third-party sites or services.
              </p>

              <Heading size="5">7. User Rights and Choices</Heading>
              <p>
                You may review, update, correct or delete the personal
                information provided in your account by contacting us. In
                certain jurisdictions, you may have legal rights to access,
                modify, or delete your personal information.
              </p>

              <Heading size="5">8. International Data Transfers</Heading>
              <p>
                Your information, including personal data, may be transferred to
                — and maintained on — computers located outside of your state,
                province, country, or other governmental jurisdiction where the
                data protection laws may differ.
              </p>

              <Heading size="5">9. Children's Privacy</Heading>
              <p>
                If a parent or guardian becomes aware that their child has
                provided us with personal information without their consent,
                they should contact us. We will delete such information from our
                files within a reasonable time.
              </p>

              <Heading size="5">10. Changes to the Privacy Policy</Heading>
              <p>
                We reserve the right to update or change our Privacy Policy at
                any time. You should check this Privacy Policy periodically.
                Your continued use of the service after we post any
                modifications to the Privacy Policy on this page will constitute
                your acknowledgment of the modifications and your consent to
                abide and be bound by the modified Privacy Policy.
              </p>

              <Heading size="5">11. Contact Information</Heading>
              <p>
                If you have any questions about this Privacy Policy, please
                contact us at m@eamonma.com
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Page
