/***************************************************************************
 * The contents of this file were generated with Amplify Studio.           *
 * Please refrain from making any modifications to this file.              *
 * Any changes to this file will be overwritten when running amplify pull. *
 **************************************************************************/

import * as React from "react";
import { GridProps, TextFieldProps } from "@aws-amplify/ui-react";
import { LoginForm } from "../API.ts";
export declare type EscapeHatchProps = {
    [elementHierarchy: string]: Record<string, unknown>;
} | null;
export declare type VariantValues = {
    [key: string]: string;
};
export declare type Variant = {
    variantValues: VariantValues;
    overrides: EscapeHatchProps;
};
export declare type ValidationResponse = {
    hasError: boolean;
    errorMessage?: string;
};
export declare type ValidationFunction<T> = (value: T, validationResponse: ValidationResponse) => ValidationResponse | Promise<ValidationResponse>;
export declare type LoginFormUpdateFormInputValues = {
    username?: string;
    password?: string;
};
export declare type LoginFormUpdateFormValidationValues = {
    username?: ValidationFunction<string>;
    password?: ValidationFunction<string>;
};
export declare type PrimitiveOverrideProps<T> = Partial<T> & React.DOMAttributes<HTMLDivElement>;
export declare type LoginFormUpdateFormOverridesProps = {
    LoginFormUpdateFormGrid?: PrimitiveOverrideProps<GridProps>;
    username?: PrimitiveOverrideProps<TextFieldProps>;
    password?: PrimitiveOverrideProps<TextFieldProps>;
} & EscapeHatchProps;
export declare type LoginFormUpdateFormProps = React.PropsWithChildren<{
    overrides?: LoginFormUpdateFormOverridesProps | undefined | null;
} & {
    id?: string;
    loginForm?: LoginForm;
    onSubmit?: (fields: LoginFormUpdateFormInputValues) => LoginFormUpdateFormInputValues;
    onSuccess?: (fields: LoginFormUpdateFormInputValues) => void;
    onError?: (fields: LoginFormUpdateFormInputValues, errorMessage: string) => void;
    onChange?: (fields: LoginFormUpdateFormInputValues) => LoginFormUpdateFormInputValues;
    onValidate?: LoginFormUpdateFormValidationValues;
} & React.CSSProperties>;
export default function LoginFormUpdateForm(props: LoginFormUpdateFormProps): React.ReactElement;
