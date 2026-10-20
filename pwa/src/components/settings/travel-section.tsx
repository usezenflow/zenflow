import { useState } from "react";
import { Bike, Car, Footprints, House, Motorbike, type LucideIcon } from "lucide-react";
import {
  type CommuteTransport,
  VEHICLES,
  type User,
  vehicleFor,
} from "@zenflow/shared";
import { HomeSheet } from "@/components/settings/home-sheet";
import { OptionSheet, type SheetOption } from "@/components/settings/option-sheet";
import { SettingsCard, SettingsLabel, SettingsRow, Divider } from "@/components/settings/settings-ui";
import { saveUser } from "@/components/settings/save-user";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";

const VEHICLE_ICONS: Record<CommuteTransport, LucideIcon> = {
  MOTORCYCLE: Motorbike,
  CAR: Car,
  BIKE: Bike,
  WALK: Footprints,
};

/** Home and vehicle: where trips to campus start and how the student gets there. */
export function TravelSection({ user, hideLabel = false }: { user: User; hideLabel?: boolean }) {
  useLanguage();
  const [homeOpen, setHomeOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const vehicle = vehicleFor(user.defaultTransport);

  const options: SheetOption<CommuteTransport>[] = VEHICLES.map((item) => ({
    value: item.id,
    label: t(item.labelKey),
    icon: VEHICLE_ICONS[item.id],
  }));

  async function saveVehicle(defaultTransport: CommuteTransport) {
    if (!(await saveUser({ defaultTransport }))) {
      errorToast(t("Could not save. Try again."));
    }
  }

  return (
    <>
      {!hideLabel && <SettingsLabel>{t("Travel")}</SettingsLabel>}
      <SettingsCard>
        <SettingsRow
          icon={House}
          title={t("Home")}
          value={user.homeLocation ?? t("Add home")}
          onClick={() => setHomeOpen(true)}
        />
        <Divider />
        <SettingsRow
          icon={VEHICLE_ICONS[vehicle.id]}
          title={t("Vehicle")}
          value={t(vehicle.labelKey)}
          onClick={() => setVehicleOpen(true)}
        />
      </SettingsCard>
      <HomeSheet open={homeOpen} onOpenChange={setHomeOpen} home={user.homeLocation} />
      <OptionSheet
        open={vehicleOpen}
        onOpenChange={setVehicleOpen}
        title={t("Vehicle")}
        options={options}
        value={vehicle.id}
        onSelect={(id) => void saveVehicle(id)}
      />
    </>
  );
}
