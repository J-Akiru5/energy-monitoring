import { AuthSplitLayout, LoginForm } from "@energy/ui";
import { login } from "./actions";

export default function LoginPage() {
  return (
    <AuthSplitLayout
      productName="Admin Portal"
      headline="Operations console for campus energy."
      tagline="Building-manager access to monitoring, controls, and reporting."
      institution={{
        name: "Western Visayas State University",
        shortName: "WVSU",
      }}
    >
      <LoginForm
        action={login}
        subheading="Sign in to the admin console."
        emailPlaceholder="admin@wvsu.edu.ph"
        supportingText="Restricted access. Activity is logged."
      />
    </AuthSplitLayout>
  );
}
