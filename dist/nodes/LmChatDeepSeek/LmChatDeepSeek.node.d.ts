import type { IExecuteFunctions, ILoadOptionsFunctions, INodePropertyOptions, INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData } from 'n8n-workflow';
export declare class LmChatDeepSeek implements INodeType {
    description: INodeTypeDescription;
    methods: {
        loadOptions: {
            fallbackModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
        };
    };
    supplyData(this: ISupplyDataFunctions | IExecuteFunctions, itemIndex: number): Promise<SupplyData>;
}
