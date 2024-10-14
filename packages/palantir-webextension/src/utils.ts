import log from "@just-log/core";

const logger = log.sub("utils");

export function assertElement(query: string, rootElem: Element = document.body): Element {
	const elem = rootElem.querySelector(query);
	if (!elem) {
		throw new Error(`Missing expected element '${query}'`);
	}
	return elem;
}

export function assertTypedElement<E extends Element>(query: string, runtimeType: new () => E, rootElem: Element = document.body): E {
	const elem = assertElement(query, rootElem);
	if (!(elem instanceof runtimeType)) {
		const expectedTypeName = runtimeType.name;
		const receivedTypeName = elem.constructor.name;
		throw new Error(`Expected element ${query} to be of type ${expectedTypeName}, but found ${receivedTypeName}`);
	}
	return elem;
}

export function initComponent<E extends Element>(query: string, runtimeType: new () => E, handler: (elem: E) => void, cleanup?: (elem: E) => void) {
	const initialElems = document.querySelectorAll(query);
	for (const elem of initialElems) {
		if (!(elem instanceof runtimeType)) {
			logger.error(`Component query '${query}' matched element not of expected type ${runtimeType.name}`);
			continue;
		}
		handler(elem);
	}

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			for (const addedNode of record.addedNodes) {
				if (!(addedNode instanceof Element)) continue;
				if (!addedNode.matches(query)) continue;
				if (!(addedNode instanceof runtimeType)) {
					logger.error(`Component query '${query}' matched element not of expected type ${runtimeType.name}`);
					continue;
				}
				handler(addedNode);
			}
			if (!cleanup) return;
			for (const removedNode of record.removedNodes) {
				if (!(removedNode instanceof Element)) continue;
				if (!removedNode.matches(query)) continue;
				if (!(removedNode instanceof Element)) continue;
				if (!removedNode.matches(query)) continue;
				if (!(removedNode instanceof runtimeType)) {
					logger.error(`Component query '${query}' matched element not of expected type ${runtimeType.name}`);
					continue;
				}
				cleanup(removedNode);
			}
		}
	});

	observer.observe(document.body, { childList: true, subtree: true });
}


export const enum FormMode {
	SUBMIT,
	EDIT,
}

export type FormFieldValue = FormDataEntryValue | boolean | null;

export interface FormFieldOptions {
	value?: FormFieldValue | (() => Promise<FormFieldValue> | FormFieldValue);
	validate?: (value: FormDataEntryValue | null) => string | undefined;
}

export interface FormOptions<F extends string> {
	query: string;
	mode?: FormMode;
	onSubmit?: (data: FormData) => void;
	fields: Partial<Record<F, FormFieldOptions>>;
}

export type FormValues<F extends string> = Partial<Record<F, FormFieldValue | (() => Promise<FormFieldValue> | FormFieldValue)>>;

export interface FormManager<F extends string> {
	set(values: FormValues<F>): Promise<void>;
	reset(): Promise<void>;
}

interface FieldValidationState {
	changed: boolean;
	valid: boolean;
}

export function initForm<F extends string>(options: FormOptions<F>, rootElem: Element = document.body): FormManager<F> {
	const form = assertTypedElement(options.query, HTMLFormElement, rootElem);
	const initialValueGetters: Partial<Record<F, () => Promise<FormFieldValue>>> = {};
	for (const fieldName in options.fields) {
		const valueOrGetter = options.fields[fieldName]?.value;
		if (typeof valueOrGetter === "function") initialValueGetters[fieldName] = async () => await valueOrGetter();
		else if (valueOrGetter !== undefined) initialValueGetters[fieldName] = () => Promise.resolve(valueOrGetter);
	}

	async function set(values: FormValues<F>) {
		for (const fieldName in values) {
			const value: FormFieldValue | undefined = typeof values[fieldName] === "function" ? await values[fieldName]() : values[fieldName];
			if (value === undefined) continue;

			const input = form.elements.namedItem(fieldName);

			if (!input) {
				logger.error(`Form has no field with name ${fieldName}`);
				continue;
			}
			if (!(input instanceof HTMLInputElement)) {
				logger.error(`Form field had unexpected type: ${input.constructor.name}`);
				continue;
			}
			if (input.type === "checkbox") {
				if (typeof value !== "boolean") {
					logger.error(`Cannot assign value ${JSON.stringify(value)} to field ${fieldName}: Only boolean values can be assigned to checkboxes`);
					continue;
				}
				input.checked = value;
			} else {
				if (typeof value !== "string") {
					logger.error(`Cannot assign value ${JSON.stringify(value)} to field ${fieldName}: Only string values can be assigned to generic input elements`);
					continue;
				}
				input.value = value;
			}
			input.dispatchEvent(new CustomEvent("change", { detail: { formSynthetic: true } }));
		}
	}

	async function reset() {
		await set(initialValueGetters);
	}

	const submitElements = form.querySelectorAll(`input[type="submit"], button[type="submit"]`);
	const validationState: Record<string, FieldValidationState> = {};

	function computeCanSubmit() {
		const isValid = Object.values(validationState).every((state) => state.valid);
		if (!isValid) return false;

		if (options.mode === FormMode.EDIT) {
			const isChanged = Object.values(validationState).some((state) => state.changed);
			if (!isChanged) return false;
		}

		return true;
	}

	function setSubmitButtonState() {
		const canSubmit = computeCanSubmit();
		for (const submitButton of submitElements) {
			if (!(submitButton instanceof HTMLButtonElement) || !(submitButton instanceof HTMLInputElement)) continue;
			submitButton.disabled = !canSubmit;
		}
	}

	function validateField(input: HTMLInputElement): boolean {
		const validator = options.fields[input.name as F]?.validate;
		if (validator) {
			input.setCustomValidity(validator(input.value) ?? "");
		}
		return input.checkValidity();
	}

	async function checkFieldChanged(input: HTMLInputElement): Promise<boolean> {
		let changed = false;
		const initialValueGetter = initialValueGetters[input.name as F];
		const initialValue = initialValueGetter ? await initialValueGetter() : undefined;

		if (input.type === "checkbox") {
			changed = input.checked !== (initialValue ?? false);
		} else {
			changed = input.value !== (initialValue ?? "");
		}

		if (changed) input.setAttribute("changed", "");
		else input.removeAttribute("changed");

		return changed;
	}

	async function updateFieldState(input: HTMLInputElement) {
		const valid = validateField(input);
		const changed = await checkFieldChanged(input);

		validationState[input.name] = {
			changed,
			valid
		}
		setSubmitButtonState();
	}

	async function updateAllFields() {
		for (const input of form.elements) {
			if (!(input instanceof HTMLInputElement)) continue;

			await updateFieldState(input);
		}
	}

	function setFieldChangeListeners() {
		for (const input of form.elements) {
			if (!(input instanceof HTMLInputElement)) continue;

			let updateEvent;
			switch (input.type) {
				case "checkbox":
					updateEvent = "change"
					break;
				case "text":
				default:
					updateEvent = "input"
			}

			input.addEventListener(updateEvent, () => {
				void updateFieldState(input);
			});
		}
	}

	void updateAllFields();
	setFieldChangeListeners();

	form.addEventListener("submit", (evt) => {
		evt.preventDefault();
		const data = new FormData(form);
		options.onSubmit?.(data);
		void updateAllFields();
	});

	// initial setup
	void reset();
	setSubmitButtonState();

	return { set, reset };
}
