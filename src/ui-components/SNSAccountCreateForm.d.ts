/***************************************************************************
 * The contents of this file were generated with Amplify Studio.           *
 * Please refrain from making any modifications to this file.              *
 * Any changes to this file will be overwritten when running amplify pull. *
 **************************************************************************/

import * as React from "react";
import { GridProps, SwitchFieldProps, TextFieldProps } from "@aws-amplify/ui-react";
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
export declare type SNSAccountCreateFormInputValues = {
    platform?: string;
    displayName?: string;
    accountId?: string;
    createdAt?: string;
    autoPost?: boolean;
    autoGenerate?: boolean;
    autoReply?: boolean;
};
export declare type SNSAccountCreateFormValidationValues = {
    platform?: ValidationFunction<string>;
    displayName?: ValidationFunction<string>;
    accountId?: ValidationFunction<string>;
    createdAt?: ValidationFunction<string>;
    autoPost?: ValidationFunction<boolean>;
    autoGenerate?: ValidationFunction<boolean>;
    autoReply?: ValidationFunction<boolean>;
};
export declare type PrimitiveOverrideProps<T> = Partial<T> & React.DOMAttributes<HTMLDivElement>;
export declare type SNSAccountCreateFormOverridesProps = {
    SNSAccountCreateFormGrid?: PrimitiveOverrideProps<GridProps>;
    platform?: PrimitiveOverrideProps<TextFieldProps>;
    displayName?: PrimitiveOverrideProps<TextFieldProps>;
    accountId?: PrimitiveOverrideProps<TextFieldProps>;
    createdAt?: PrimitiveOverrideProps<TextFieldProps>;
    autoPost?: PrimitiveOverrideProps<SwitchFieldProps>;
    autoGenerate?: PrimitiveOverrideProps<SwitchFieldProps>;
    autoReply?: PrimitiveOverrideProps<SwitchFieldProps>;
} & EscapeHatchProps;
export declare type SNSAccountCreateFormProps = React.PropsWithChildren<{
    overrides?: SNSAccountCreateFormOverridesProps | undefined | null;
} & {
    clearOnSuccess?: boolean;
    onSubmit?: (fields: SNSAccountCreateFormInputValues) => SNSAccountCreateFormInputValues;
    onSuccess?: (fields: SNSAccountCreateFormInputValues) => void;
    onError?: (fields: SNSAccountCreateFormInputValues, errorMessage: string) => void;
    onChange?: (fields: SNSAccountCreateFormInputValues) => SNSAccountCreateFormInputValues;
    onValidate?: SNSAccountCreateFormValidationValues;
} & React.CSSProperties>;
export default function SNSAccountCreateForm(props: SNSAccountCreateFormProps): React.ReactElement;
