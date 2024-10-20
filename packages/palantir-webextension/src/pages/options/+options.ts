import { getOptions, setOptions } from "../../options";
import { assertTypedElement } from "../../utils/query";
import { FormMode, initForm } from "../../utils/form";
import { baseLogger } from "../../logger";

const logger = baseLogger.sub("page", "options");

const useApiKeyInput = assertTypedElement("#options__use-api-key", HTMLInputElement);
const apiKeyInput = assertTypedElement("#options__api-key", HTMLInputElement);

initForm({
	query: "#options__form",
	mode: FormMode.EDIT,
	resetButton: "#options__reset",
	onSubmit,
	fields: {
		username: {
			value: async () => (await getOptions()).username ?? "",
			validate: validateUsername
		},
		serverUrl: {
			value: async () => (await getOptions()).serverUrl ?? "",
			validate: validateServerUrl
		},
		useApiKey: {
			value: async () => (await getOptions()).apiKey !== undefined,
		},
		apiKey: {
			value: async () => (await getOptions()).apiKey ?? "",
			validate: validateApiKey
		}
	}
})


function updateApiKeyInput() {
	apiKeyInput.disabled = !useApiKeyInput.checked;
}

function validateUsername(value: FormDataEntryValue | null) {
	if (typeof value !== "string") {
		return "Only text input is allowed";
	}
	if (!value) return "Please enter a username";
	if (value.length < 3) return "Username must have at least 3 characters";
	if (value.length > 100) return "Username cannot have more than 100 characters";
	return "";
}

function validateServerUrl(value: FormDataEntryValue | null) {
	if (typeof value !== "string") {
		return "Only text input is allowed";
	}
	const url = URL.parse(value);
	if (!url) {
		return "Please enter a valid URL";
	}
	if (!["ws:", "wss:"].includes(url.protocol)) {
		return "Please enter a websocket url (wss://)";
	}
}

function validateApiKey(value: FormDataEntryValue | null) {
	if (typeof value !== "string") {
		return "Only text input is allowed";
	}
	if (!value) return "Please enter an API key";
	return "";
}

function onSubmit(data: FormData) {
	const username = (data.get("username") ?? "") as string;
	const serverUrl = (data.get("serverUrl") ?? "") as string;
	const useApiKey = !!data.get("useApiKey");
	const apiKey = (data.get("apiKey") ?? "") as string;


	setOptions({ username, serverUrl, apiKey: useApiKey ? apiKey : undefined })
		.catch((err: unknown) => {
			logger.error(`Failed to set options`, err);
		});
	void browser.runtime.sendMessage({ type: "options_changed" });
}

useApiKeyInput.addEventListener("change", () => {
	updateApiKeyInput();
})

updateApiKeyInput();
