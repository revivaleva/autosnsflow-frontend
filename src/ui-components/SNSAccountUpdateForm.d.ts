/***************************************************************************
 * The contents of this file were generated with Amplify Studio.           *
 * Please refrain from making any modifications to this file.              *
 * Any changes to this file will be overwritten when running amplify pull. *
 **************************************************************************/

import * as React from "react";
import { GridProps, SwitchFieldProps, TextFieldProps } from "@aws-amplify/ui-react";
import { SNSAccount } from "../API.ts";
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
export declare type SNSAccountUpdateFormInputValues = {
    platform?: string;
    displayName?: string;
    accountId?: string;
    createdAt?: string;
    autoPost?: boolean;
    autoGenerate?: boolean;
    autoReply?: boolean;
};
export declare type SNSAccountUpdateFormValidationValues = {
    platform?: ValidationFunction<string>;
    displayName?: ValidationFunction<string>;
    accountId?: ValidationFunction<string>;
    createdAt?: ValidationFunction<string>;
    autoPost?: ValidationFunction<boolean>;
    autoGenerate?: ValidationFunction<boolean>;
    autoReply?: ValidationFunction<boolean>;
};
export declare type PrimitiveOverrideProps<T> = Partial<T> & React.DOMAttributes<HTMLDivElement>;
export declare type SNSAccountUpdateFormOverridesProps = {
    SNSAccountUpdateFormGrid?: PrimitiveOverrideProps<GridProps>;
    platform?: PrimitiveOverrideProps<TextFieldProps>;
    displayName?: PrimitiveOverrideProps<TextFieldProps>;
    accountId?: PrimitiveOverrideProps<TextFieldProps>;
    createdAt?: PrimitiveOverrideProps<TextFieldProps>;
    autoPost?: PrimitiveOverrideProps<SwitchFieldProps>;
    autoGenerate?: PrimitiveOverrideProps<SwitchFieldProps>;
    autoReply?: PrimitiveOverrideProps<SwitchFieldProps>;
} & EscapeHatchProps;
export declare type SNSAccountUpdateFormProps = React.PropsWithChildren<{
    overrides?: SNSAccountUpdateFormOverridesProps | undefined | null;
} & {
    id?: string;
    sNSAccount?: SNSAccount;
    onSubmit?: (fields: SNSAccountUpdateFormInputValues) => SNSAccountUpdateFormInputValues;
    onSuccess?: (fields: SNSAccountUpdateFormInputValues) => void;
    onError?: (fields: SNSAccountUpdateFormInputValues, errorMessage: string) => void;
    onChange?: (fields: SNSAccountUpdateFormInputValues) => SNSAccountUpdateFormInputValues;
    onValidate?: SNSAccountUpdateFormValidationValues;
} & React.CSSProperties>;
export default function SNSAccountUpdateForm(props: SNSAccountUpdateFormProps): React.ReactElement;
