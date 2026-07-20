/**
 * AddressStep — the register flow's final "Manzil" step (mockup frame A6
 * "Yashash manzili"): a Viloyat dropdown, a cascading Tuman dropdown, and a
 * free-text "Ko'cha, uy, xonadon" box, under the Hisob→Aloqa→Manzil stepper.
 * "Tugatish va boshlash" PATCHes the profile and lands the user on Home.
 * Region + district are required; the street is optional.
 */
import { useId, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Text, cx } from "../../shared/ui";
import { RegisterStepper } from "./RegisterStepper";
import { SelectField } from "./SelectField";
import { BackIcon, CheckIcon, PinIcon } from "./icons";
import { UZ_REGION_NAMES, districtsFor } from "./uz-regions";
import styles from "./Auth.module.css";

export interface AddressStepProps {
  region: string;
  district: string;
  street: string;
  onRegionChange: (value: string) => void;
  onDistrictChange: (value: string) => void;
  onStreetChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  busy: boolean;
  error?: string | null;
}

export function AddressStep({
  region,
  district,
  street,
  onRegionChange,
  onDistrictChange,
  onStreetChange,
  onSubmit,
  onBack,
  busy,
  error,
}: AddressStepProps) {
  const { t } = useTranslation();
  const streetId = useId();
  const districts = districtsFor(region);
  const canSubmit = region !== "" && district !== "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy && canSubmit) onSubmit();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.codeHead}>
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label={t("common.back")}>
          <BackIcon />
        </button>
        <Text as="h2" variant="title-m">
          {t("auth.address.title")}
        </Text>
      </div>

      <RegisterStepper current="manzil" />

      <p className={styles.addressNote}>{t("auth.address.note")}</p>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <SelectField
        label={t("auth.address.regionLabel")}
        icon={<PinIcon />}
        value={region}
        onChange={onRegionChange}
        placeholder={t("auth.address.regionPlaceholder")}
        options={UZ_REGION_NAMES}
        autoFocus
      />

      <SelectField
        label={t("auth.address.districtLabel")}
        value={district}
        onChange={onDistrictChange}
        placeholder={
          region === ""
            ? t("auth.address.districtPlaceholderEmpty")
            : t("auth.address.districtPlaceholder")
        }
        options={districts}
        disabled={region === ""}
      />

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={streetId}>
          {t("auth.address.streetLabel")}
        </label>
        <div className={cx(styles.fieldControl, styles.streetControl)}>
          <textarea
            id={streetId}
            className={cx(styles.fieldInput, styles.streetInput)}
            rows={2}
            value={street}
            onChange={(ev) => onStreetChange(ev.target.value)}
            placeholder={t("auth.address.streetPlaceholder")}
          />
        </div>
      </div>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!canSubmit}>
        {t("auth.address.finish")}
        <CheckIcon />
      </Button>
    </form>
  );
}
