import { AuthSplitLayout, LoginForm } from "@energy/ui";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <AuthSplitLayout
      productName="Energy Monitoring"
      headline={"Energy intelligence for\nWestern Visayas State University."}
      tagline="Real-time visibility into campus energy use — measured, reported, and acted on."
      institution={{
        name: "Western Visayas State University",
        shortName: "WVSU",
      }}
      features={[
        {
          title: "Real-time Monitoring",
          description:
            "Live voltage, current, and power telemetry from monitored panels.",
        },
        {
          title: "Sustainable Operations",
          description:
            "Track consumption against institutional efficiency goals.",
        },
        {
          title: "Multi-Site Management",
          description:
            "Built to scale across buildings, colleges, and remote facilities.",
        },
        {
          title: "Data-Driven Decisions",
          description:
            "Historical trends, cost estimates, and exportable reports.",
        },
      ]}
    >
      <LoginForm
        action={login}
        subheading="Sign in to your WVSU monitoring account."
        emailPlaceholder="you@wvsu.edu.ph"
        supportingText="Access is limited to authorized accounts."
      />
    </AuthSplitLayout>
  );
}
