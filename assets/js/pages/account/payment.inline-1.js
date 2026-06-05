const connectBtn = document.getElementById("connectBtn");
const statusEl = document.getElementById("status");
const rewardTypeInputs = Array.from(
  document.querySelectorAll('input[name="rewardType"]'),
);
const creditProviderField = document.getElementById("creditProviderField");
const creditProviderEl = document.getElementById("creditProvider");
const methodEl = document.getElementById("method");
const countryEl = document.getElementById("country");

function selectedRewardType() {
  const selected = rewardTypeInputs.find((el) => el.checked);
  return selected ? selected.value : "cash";
}

function syncRewardTypeUi() {
  const type = selectedRewardType();
  const credits = type === "credits";
  creditProviderField.hidden = !credits;
  if (credits) {
    methodEl.value = "AI credits wallet";
    countryEl.value = "N/A (credit payout)";
  } else {
    methodEl.value = "Bank account ending •••• 4242";
    countryEl.value = "United States";
  }
}

rewardTypeInputs.forEach((el) => {
  el.addEventListener("change", syncRewardTypeUi);
});

connectBtn.addEventListener("click", () => {
  const rewardType = selectedRewardType();
  const creditProvider = rewardType === "credits" ? creditProviderEl.value : "";
  statusEl.classList.add("show");
  connectBtn.textContent = "Saved";
  statusEl.textContent =
    rewardType === "credits"
      ? `Receiving method saved. Approved claims would route as ${creditProvider}.`
      : "Receiving method saved. Approved cash-back claims would route here as real cash.";
  if (window.hugEvent)
    hugEvent("cashback_receiving_method_saved", {
      reward_type: rewardType,
      credit_provider: creditProvider,
      email_entered: Boolean(document.getElementById("email").value.trim()),
      country: document.getElementById("country").value.trim(),
    });
});

syncRewardTypeUi();
