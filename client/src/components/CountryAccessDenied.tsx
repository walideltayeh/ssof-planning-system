import { Lock } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { useCountry } from "@/contexts/CountryContext";
import { useLocation } from "wouter";

interface Props {
  country?: string | null;
  ownerName?: string | null;
}

export default function CountryAccessDenied({ country, ownerName }: Props) {
  const { clearCountry } = useCountry();
  const [, navigate] = useLocation();

  const label = country?.trim() ? country : "this country";
  const owner = ownerName?.trim() ? ownerName : "the workspace owner";

  const handleSwitch = () => {
    clearCountry();
    navigate("/");
  };

  return (
    <Empty className="border bg-white/60">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-amber-100 text-amber-700">
          <Lock />
        </EmptyMedia>
        <EmptyTitle>{label} isn&apos;t part of your access</EmptyTitle>
        <EmptyDescription>
          Your account isn&apos;t assigned to {label}. Ask {owner} to grant
          access if you need to view or edit this country&apos;s data.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={handleSwitch}>
          Switch country
        </Button>
      </EmptyContent>
    </Empty>
  );
}
