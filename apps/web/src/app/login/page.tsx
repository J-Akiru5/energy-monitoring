import { AuthSplitLayout, LoginForm } from "@energy/ui";
import { login } from "./actions";

const FeatureIcons = {
  monitoring: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 7A1.5 1.5 0 0 0 8 8.5v8a1.5 1.5 0 0 0 3 0v-8A1.5 1.5 0 0 0 9.5 7ZM3.5 12A1.5 1.5 0 0 0 2 13.5v3a1.5 1.5 0 0 0 3 0v-3A1.5 1.5 0 0 0 3.5 12Z" />
    </svg>
  ),
  sustainable: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path fillRule="evenodd" d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06A.75.75 0 1 1 4.99 5.16L5.05 3.05Zm9.9 0a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.06-1.06ZM10 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-3.5 5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" clipRule="evenodd" />
    </svg>
  ),
  multiSite: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
    </svg>
  ),
  decisions: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
    </svg>
  ),
};

export default function LoginPage() {
  return (
    <AuthSplitLayout
      productName="Energy Monitoring"
      headline="Powering\nSmarter Campuses"
      tagline="Real-time energy monitoring, actionable insights, and a more sustainable future for educational institutions."
      institution={{
        name: "Western Visayas State University",
        shortName: "WVSU",
      }}
      footer="Monitor • Optimize • Sustain"
      features={[
        {
          title: "Real-time Monitoring",
          description: "Live energy data at your fingertips.",
          icon: FeatureIcons.monitoring,
        },
        {
          title: "Sustainable Operations",
          description: "Build a greener tomorrow.",
          icon: FeatureIcons.sustainable,
        },
        {
          title: "Multi-Site Management",
          description: "Unify your facilities in one platform.",
          icon: FeatureIcons.multiSite,
        },
        {
          title: "Data-Driven Decisions",
          description: "Turn data into meaningful action.",
          icon: FeatureIcons.decisions,
        },
      ]}
    >
      <LoginForm
        action={login}
        subheading="Sign in to your account to continue."
        emailPlaceholder="you@wvsu.edu.ph"
        supportingText="Access is limited to authorized accounts."
      />
    </AuthSplitLayout>
  );
}
